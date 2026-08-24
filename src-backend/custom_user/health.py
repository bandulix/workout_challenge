"""Apple Health / Google Health Connect integration via Open Wearables.

Apple HealthKit and Google Health Connect have no cloud API - the data
only exists on the user's phone. We therefore run a self-hosted Open
Wearables instance (MIT-licensed, https://github.com/the-momentum/
open-wearables) beside this stack: the athlete's phone app pushes the
on-device workouts to Open Wearables, and this connector polls its
unified REST API - the same shape as the Strava/Garmin connectors.

Linkage model:
  - Server-side we only store the Open Wearables user UUID on the user
    (``health_user_id``); the instance URL + API key live in Site
    Settings / env (``resolve_health_settings``), never per user.
  - Onboarding: the link endpoint creates the OW user (once) and hands
    back a single-use invitation code; the athlete enters host + code in
    the health app (Open Wearables example/official app) which then
    syncs Apple Health / Health Connect in the background.

Sync mirrors the Garmin flow: recent workouts are mapped onto
``workouts.Workout`` rows, de-duplicated by ``health_id`` (the OW
workout UUID) plus the cross-provider duplicate guard, with an hourly
Celery beat job and a manual (rate-limited) re-sync button.
"""

import datetime
import logging

import requests
from django.contrib.auth import get_user_model
from django.utils import timezone

from workout_challenge.celery import app, is_task_already_executing
from workouts.models import Workout, SPORT_TYPES, find_duplicate_workout

logger = logging.getLogger(__name__)

HEALTH_HTTP_TIMEOUT = 15
MAX_HR_ESTIMATE = 180


class HealthConfigError(Exception):
    """Open Wearables is not configured (no base URL / API key)."""


class HealthUnavailableError(Exception):
    """Network / Open-Wearables-side failure."""


# ---------------------------------------------------------------------------
# Open Wearables API client
# ---------------------------------------------------------------------------

def _ow_config():
    from site_settings.models import resolve_health_settings
    cfg = resolve_health_settings()
    if not cfg["enabled"]:
        raise HealthConfigError("Open Wearables is not configured (Site Settings -> Health).")
    return cfg


def _developer_token(cfg, force_login=False):
    """A developer JWT for the OW instance, cached until shortly before
    its (server-configured, default 60 min) expiry. Developer auth works
    on every OW endpoint - user management, data reads AND invitation
    codes - so one credential pair is all the connector needs."""
    from django.core.cache import cache
    cache_key = f"health_developer_jwt_{cfg['base_url']}_{cfg['developer_email']}"
    if not force_login:
        cached = cache.get(cache_key)
        if cached:
            return cached
    try:
        response = requests.post(
            f"{cfg['base_url']}/api/v1/auth/login",
            data={"username": cfg["developer_email"], "password": cfg["developer_password"]},
            timeout=HEALTH_HTTP_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise HealthUnavailableError("Could not reach the Open Wearables instance.") from exc
    if response.status_code >= 400:
        logger.warning("Open Wearables login failed with HTTP %s", response.status_code)
        raise HealthUnavailableError("Open Wearables rejected the configured developer login.")
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise HealthUnavailableError("Open Wearables login returned no token.")
    ttl = max(int(payload.get("expires_in", 3600)) - 120, 60)
    cache.set(cache_key, token, min(ttl, 3000))
    return token


def _ow_request(method, path, _retried=False, **kwargs):
    cfg = _ow_config()
    token = _developer_token(cfg, force_login=_retried)
    try:
        response = requests.request(
            method,
            f"{cfg['base_url']}/api/v1{path}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=HEALTH_HTTP_TIMEOUT,
            **kwargs,
        )
    except requests.RequestException as exc:
        raise HealthUnavailableError("Could not reach the Open Wearables instance.") from exc
    if response.status_code == 401 and not _retried:
        # Expired/revoked token - log in once more and retry.
        return _ow_request(method, path, _retried=True, **kwargs)
    if response.status_code == 404:
        logger.warning("Open Wearables %s %s -> 404", method, path)
        return None
    if response.status_code == 409:
        return {"_conflict": True}
    if response.status_code >= 400:
        logger.warning("Open Wearables %s %s -> %s", method, path, response.status_code)
        raise HealthUnavailableError(f"Open Wearables answered HTTP {response.status_code}.")
    return response.json()


def ensure_health_user(user) -> str:
    """Return the user's Open Wearables UUID, creating the OW user once.

    A 409 on creation means the email already exists over there (e.g. our
    DB was rebuilt while OW kept its data) - adopt that user's UUID
    instead of failing.
    """
    if user.health_user_id:
        return user.health_user_id
    created = _ow_request("POST", "/users", json={
        "first_name": user.first_name or None,
        "last_name": user.last_name or None,
        "email": user.email or None,
    })
    if created and created.get("_conflict"):
        existing = _ow_request("GET", "/users", params={"email": user.email, "limit": 1})
        items = (existing or {}).get("data") or (existing or {}).get("items") or []
        created = items[0] if items else None
    if not created or not created.get("id"):
        raise HealthUnavailableError("Open Wearables did not return a user id.")
    user.health_user_id = str(created["id"])
    user.save(update_fields=["health_user_id"])
    return user.health_user_id


def generate_invitation(user) -> dict:
    """Mint a fresh single-use invitation code for the health app."""
    health_user_id = ensure_health_user(user)
    invitation = _ow_request("POST", f"/users/{health_user_id}/invitation-code")
    if not invitation or not invitation.get("code"):
        raise HealthUnavailableError("Open Wearables did not return an invitation code.")
    from site_settings.models import resolve_health_settings
    return {
        "code": invitation["code"],
        "expires_at": invitation.get("expires_at"),
        # The phone-facing address (public_url), not necessarily the
        # internal one the backend polls.
        "host": resolve_health_settings()["public_url"],
    }


# ---------------------------------------------------------------------------
# Workout mapping
# ---------------------------------------------------------------------------

_VALID_SPORT_TYPES = {key for key, _label in SPORT_TYPES}

# Health Connect (Android) and Apple HealthKit (iOS) workout type names,
# lowercased/underscored, mapped onto our sport types. Open Wearables
# passes the source strings through, so both ecosystems are covered.
HEALTH_SPORT_MAP = {
    "running": "Run",
    "running_track": "Run",
    "running_treadmill": "VirtualRun",
    "trail_running": "TrailRun",
    "treadmill": "VirtualRun",
    "treadmill_running": "VirtualRun",
    "indoor_running": "VirtualRun",
    "cycling": "Ride",
    "cycling_stationary": "VirtualRide",
    "biking": "Ride",
    "biking_road": "Ride",
    "e_bike": "EBikeRide",
    "ebike": "EBikeRide",
    "gravel_cycling": "GravelRide",
    "mountain_biking": "MountainBikeRide",
    "e_mountain_biking": "EMountainBikeRide",
    "indoor_cycling": "VirtualRide",
    "spinning": "VirtualRide",
    "walking": "Walk",
    "walking_for_fitness": "Walk",
    "hiking": "Hike",
    "snowshoeing": "Snowshoe",
    "swimming": "Swim",
    "swimming_pool": "Swim",
    "swimming_open_water": "Swim",
    "pool_swimming": "Swim",
    "open_water_swimming": "Swim",
    "rowing": "Rowing",
    "indoor_rowing": "VirtualRow",
    "rowing_machine": "VirtualRow",
    "stair_climbing_machine": "StairStepper",
    "kayaking": "Kayaking",
    "canoeing": "Canoeing",
    "paddleboarding": "StandUpPaddling",
    "stand_up_paddleboarding": "StandUpPaddling",
    "surfing": "Surfing",
    "windsurfing": "Windsurf",
    "kitesurfing": "Kitesurf",
    "sailing": "Sail",
    "skiing": "AlpineSki",
    "skiing_downhill": "AlpineSki",
    "skiing_cross_country": "NordicSki",
    "cross_country_skiing": "NordicSki",
    "backcountry_skiing": "BackcountrySki",
    "roller_skiing": "RollerSki",
    "snowboarding": "Snowboard",
    "ice_skating": "IceSkate",
    "inline_skating": "InlineSkate",
    "skateboarding": "Skateboard",
    "roller_skating": "InlineSkate",
    "elliptical": "Elliptical",
    "stair_climbing": "StairStepper",
    "stair_stepper": "StairStepper",
    "hiit": "HighIntensityIntervalTraining",
    "high_intensity_interval_training": "HighIntensityIntervalTraining",
    "crossfit": "Crossfit",
    "cross_fit": "Crossfit",
    "strength_training": "WeightTraining",
    "traditional_strength_training": "WeightTraining",
    "functional_strength_training": "WeightTraining",
    "weightlifting": "WeightTraining",
    "pilates": "Pilates",
    "yoga": "Yoga",
    "rock_climbing": "RockClimbing",
    "bouldering": "RockClimbing",
    "climbing": "RockClimbing",
    "soccer": "Soccer",
    "football": "Soccer",
    "squash": "Squash",
    "badminton": "Badminton",
    "tennis": "Tennis",
    "table_tennis": "TableTennis",
    "pickleball": "Pickleball",
    "racquetball": "Racquetball",
    "golf": "Golf",
    "wheelchair": "Wheelchair",
    "wheelchair_walk_pace": "Wheelchair",
    "wheelchair_run_pace": "Wheelchair",
    "handcycle": "Handcycle",
}


def map_health_sport_type(raw_type) -> str:
    """OW workout type -> our sport type (unknown types -> 'Workout',
    same philosophy as the Strava unknown-type guard).

    Health Connect emits UPPER_SNAKE names, Apple HealthKit camelCase
    ("traditionalStrengthTraining") - both are normalised to
    lower_snake_case before the lookup.
    """
    import re
    key = str(raw_type or "").strip()
    # camelCase -> snake_case, then lowercase everything.
    key = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key)
    key = key.lower().replace(" ", "_").replace("-", "_")
    mapped = HEALTH_SPORT_MAP.get(key)
    if mapped:
        return mapped
    # Already one of ours (e.g. OW normalized it or a custom type matches)?
    if raw_type in _VALID_SPORT_TYPES:
        return raw_type
    return "Workout"


def _parse_dt(raw):
    if not raw:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, datetime.timezone.utc)
    return dt


def _estimate_intensity(avg_hr, kcal, duration_seconds) -> int:
    kcal_per_ten_min = kcal / (max(duration_seconds, 60) / 600) if kcal else 0
    if (avg_hr and avg_hr > MAX_HR_ESTIMATE * 0.85) or kcal_per_ten_min > 120:
        return 4
    if (avg_hr and avg_hr > MAX_HR_ESTIMATE * 0.70) or kcal_per_ten_min > 90:
        return 3
    if (avg_hr and avg_hr > MAX_HR_ESTIMATE * 0.60) or kcal_per_ten_min > 75:
        return 2
    return 1


def _as_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def distance_km_from_ow(ow_workout: dict, duration_s) -> float | None:
    """OW workout payload -> kilometres.

    Canonical unit is metres (``distance_meters``). Health Connect
    sometimes omits it, sends a generic ``distance``, or (rarely) already
    ships kilometres as a small number. Prefer explicit metres, then
    derive from average pace, then treat a small value as km only when
    the implied pace is athletic.
    """
    raw = (
        ow_workout.get("distance_meters")
        if ow_workout.get("distance_meters") not in (None, "", 0)
        else None
    )
    if raw is None:
        for key in ("distance_m", "distance", "total_distance"):
            if ow_workout.get(key) not in (None, "", 0):
                raw = ow_workout.get(key)
                break
    metres = _as_float(raw)
    if metres is not None and metres > 0:
        if metres >= 200:
            return round(metres / 1000, 2)
        duration_min = (duration_s or 0) / 60
        # Athletic 2.5–20 min/km: a 5 km run sent as 5.0 with a 25 min
        # duration matches; a 50 m sprint in 10 s does not (treated as m).
        if metres >= 0.2 and duration_min >= metres * 2.5 and duration_min <= metres * 20:
            return round(metres, 2)
        return round(metres / 1000, 2)

    pace = _as_float(ow_workout.get("avg_pace_sec_per_km"))
    if pace and pace > 0 and duration_s:
        return round(float(duration_s) / pace, 2)
    return None


def _ow_pick(ow_workout, *keys):
    for key in keys:
        value = ow_workout.get(key)
        if value not in (None, "", 0):
            return value
    return None


# Android SDK unified payload uses camelCase (startDate/endDate). The
# public Workout schema aliases those as start_time/end_time; EventRecord
# uses start_datetime. Flatten so one mapper covers all three.
_OW_FIELD_ALIASES = {
    "startDate": "start_time",
    "endDate": "end_time",
    "startDatetime": "start_datetime",
    "endDatetime": "end_datetime",
    "durationSeconds": "duration_seconds",
    "workoutType": "type",
    "activityType": "type",
    "caloriesKcal": "calories_kcal",
    "distanceMeters": "distance_meters",
    "avgHeartRateBpm": "avg_heart_rate_bpm",
    "avgPaceSecPerKm": "avg_pace_sec_per_km",
    "workoutId": "id",
}


def _flatten_ow_workout(ow_workout: dict) -> dict:
    if not isinstance(ow_workout, dict):
        return {}
    nested = ow_workout.get("workout") or ow_workout.get("event")
    if isinstance(nested, dict):
        merged = {**nested, **{k: v for k, v in ow_workout.items() if k not in ("workout", "event")}}
    else:
        merged = dict(ow_workout)
    for src, dest in _OW_FIELD_ALIASES.items():
        if merged.get(dest) in (None, "", 0) and merged.get(src) not in (None, "", 0):
            merged[dest] = merged[src]
    return merged


def workout_to_props(user, ow_workout: dict) -> dict | None:
    """Map one Open Wearables workout onto Workout field values."""
    ow_workout = _flatten_ow_workout(ow_workout)
    # OW's unified event schema uses start_datetime / end_datetime;
    # Health Connect dumps and older docs also use start_time.
    health_id = _ow_pick(ow_workout, "id", "uuid", "workout_id")
    start_dt = _parse_dt(_ow_pick(ow_workout, "start_time", "start_datetime", "start", "startDate"))
    if not health_id or start_dt is None:
        return None

    duration_raw = _ow_pick(ow_workout, "duration_seconds", "duration", "elapsed_time")
    if duration_raw is None:
        values = ow_workout.get("values")
        if isinstance(values, list):
            for item in values:
                if isinstance(item, dict) and str(item.get("type") or "").lower() == "duration":
                    duration_raw = item.get("value")
                    break
    duration_s = _as_float(duration_raw)
    duration_s = int(duration_s) if duration_s else None
    end_dt = _parse_dt(_ow_pick(ow_workout, "end_time", "end_datetime", "end", "endDate"))
    if not duration_s and end_dt is not None:
        duration_s = max(int((end_dt - start_dt).total_seconds()), 0)
    if not duration_s:
        return None

    kcal = _ow_pick(ow_workout, "calories_kcal", "calories", "kcal")
    avg_hr = _ow_pick(ow_workout, "avg_heart_rate_bpm", "avg_hr", "average_heart_rate")

    return {
        "user": user,
        "health_id": str(health_id),
        "sport_type": map_health_sport_type(ow_workout.get("type")),
        "start_datetime": start_dt,
        "duration": datetime.timedelta(seconds=int(duration_s)),
        "distance": distance_km_from_ow(ow_workout, duration_s),
        "kcal": None if kcal is None else round(float(kcal)),
        "intensity_category": _estimate_intensity(avg_hr, kcal, int(duration_s)),
    }


# ---------------------------------------------------------------------------
# Sync tasks
# ---------------------------------------------------------------------------

def _ow_dt_param(dt):
    """UTC Z timestamp - some OW builds reject +00:00 and microseconds."""
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ow_page_items_and_cursor(page):
    """Unpack one OW list-workouts page (flat list or PaginatedResponse)."""
    if isinstance(page, list):
        return page, None
    # `[] or next` is wrong: an empty `data` list is a finished page,
    # not a cue to fall through to a different key.
    if "data" in page and isinstance(page.get("data"), list):
        items = page.get("data")
    else:
        items = page.get("items") or page.get("results") or []
    pagination = page.get("pagination") if isinstance(page.get("pagination"), dict) else {}
    next_cursor = (
        pagination.get("next_cursor")
        or page.get("next_cursor")
        or page.get("next")
        or page.get("cursor")
    )
    if pagination.get("has_more") is False:
        next_cursor = None
    return items, next_cursor


def _fetch_workouts(health_user_id: str, since: datetime.datetime) -> list:
    """All OW workouts for the user since ``since`` (cursor pagination)."""
    until = timezone.now() + datetime.timedelta(minutes=5)
    workouts, cursor = [], None
    while True:
        params = {
            "start_date": _ow_dt_param(since),
            "end_date": _ow_dt_param(until),
            "limit": 100,
        }
        if cursor:
            params["cursor"] = cursor
        page = _ow_request("GET", f"/users/{health_user_id}/events/workouts", params=params)
        if page is None:
            # OW 404: the user vanished server-side - treat as empty, the
            # caller decides whether to drop the linkage.
            logger.warning("Open Wearables returned 404 listing workouts for user %s", health_user_id)
            return []
        items, next_cursor = _ow_page_items_and_cursor(page)
        workouts.extend(items)
        cursor = next_cursor
        if not cursor or not items:
            break
    return workouts


INGEST_RETRY_PAUSES = (2, 3)


def _sync_user_workouts(user, start_datetime=None, wait_for_ingest=False) -> dict:
    # Same window as Garmin hourly/manual: watches and Health Connect
    # often land late. Initial link still requests ~43 days separately.
    since = start_datetime or (timezone.now() - datetime.timedelta(days=14))
    ow_workouts = _fetch_workouts(user.health_user_id, since)
    # SDK ingest is queued on OW's Celery worker, so a poll that races
    # the phone's POST /sdk/.../sync can still see an empty list.
    if wait_for_ingest and not ow_workouts:
        import time
        for pause in INGEST_RETRY_PAUSES:
            time.sleep(pause)
            ow_workouts = _fetch_workouts(user.health_user_id, since)
            if ow_workouts:
                break

    # Only the fetched ids - not the whole table's health rows (which
    # loaded every user's full Workout instances per user per sync).
    ow_ids = []
    for w in ow_workouts:
        hid = _ow_pick(_flatten_ow_workout(w), "id", "uuid", "workout_id")
        if hid:
            ow_ids.append(str(hid))
    existing_map = Workout.objects.filter(health_id__in=ow_ids).in_bulk(field_name='health_id')
    created = updated = skipped = duplicates = 0
    for ow_workout in ow_workouts:
        try:
            props = workout_to_props(user, ow_workout)
        except Exception:
            logger.exception("Health workout mapping failed for user %s", user.pk)
            skipped += 1
            continue
        if props is None:
            skipped += 1
            continue
        health_id = props["health_id"]
        if health_id in existing_map:
            workout = existing_map[health_id]
            if workout is not None and workout.user_id == user.id:
                for key, value in props.items():
                    setattr(workout, key, value)
                workout.save()
                updated += 1
            continue
        # Cross-provider duplicate guard: the same activity may already
        # exist from Strava/Garmin or as a manual entry - never twice.
        if find_duplicate_workout(user, props["start_datetime"], props["duration"], provider="health") is not None:
            duplicates += 1
            continue
        Workout.objects.create(**props)
        created += 1

    user.health_last_synced_at = timezone.now()
    user.save(update_fields=["health_last_synced_at"])
    return {"fetched": len(ow_workouts), "created": created, "updated": updated, "skipped": skipped, "duplicates_skipped": duplicates}


@app.task(bind=True, time_limit=60 * 30)
def sync_health(self, user__id, start_datetime=None, wait_for_ingest=False):
    CustomUser = get_user_model()
    user = CustomUser.objects.get(id=user__id)

    # One activity source per user: when another provider is selected,
    # Health must not import - the same activities would arrive twice.
    if user.get_activity_source() != 'health':
        logger.info("Health sync user %s skipped: Health is not the selected activity source", user__id)
        return {"user": user__id, "skipped": "health is not the selected activity source"}

    result = _sync_user_workouts(
        user, start_datetime=start_datetime, wait_for_ingest=wait_for_ingest,
    )
    logger.info("Health sync user %s: %s", user__id, result)
    return {"user": user__id, **result}


@app.task(bind=True, time_limit=60 * 60 * 2, max_retries=3)
def daily_health_sync(self):
    if is_task_already_executing("daily_health_sync"):
        return "Task already executing. Skipping."

    CustomUser = get_user_model()
    user_lst = CustomUser.objects.filter(
        health_user_id__isnull=False,
        is_active=True,
    ).exclude(health_user_id="").order_by("health_last_synced_at", "pk")

    logger.info('Syncing Health for %s users', user_lst.count())
    for user in user_lst:
        # Per-user throttle matching the hourly beat schedule (55 < 60 so
        # scheduler jitter can't push anyone to a two-hour cadence).
        if user.health_last_synced_at and user.health_last_synced_at > timezone.now() - datetime.timedelta(minutes=55):
            continue
        try:
            sync_health(user__id=user.id)
        except (HealthConfigError, HealthUnavailableError) as exc:
            logger.exception('Health sync failed for user %s', user.pk)
        except Exception as exc:  # noqa: BLE001 - never sink the whole sweep
            logger.exception('Health sync failed for user %s', user.pk)

    logger.info('Finished syncing Health.')
    return "done"

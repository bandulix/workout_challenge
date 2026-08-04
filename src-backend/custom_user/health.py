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


def _ow_request(method, path, **kwargs):
    cfg = _ow_config()
    try:
        response = requests.request(
            method,
            f"{cfg['base_url']}/api/v1{path}",
            headers={"X-Open-Wearables-API-Key": cfg["api_key"]},
            timeout=HEALTH_HTTP_TIMEOUT,
            **kwargs,
        )
    except requests.RequestException as exc:
        raise HealthUnavailableError("Could not reach the Open Wearables instance.") from exc
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        logger.warning("Open Wearables %s %s -> %s", method, path, response.status_code)
        raise HealthUnavailableError(f"Open Wearables answered HTTP {response.status_code}.")
    return response.json()


def ensure_health_user(user) -> str:
    """Return the user's Open Wearables UUID, creating the OW user once."""
    if user.health_user_id:
        return user.health_user_id
    created = _ow_request("POST", "/users", json={
        "first_name": user.first_name or None,
        "last_name": user.last_name or None,
        "email": user.email or None,
    })
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
        "host": resolve_health_settings()["base_url"],
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
    "trail_running": "TrailRun",
    "treadmill": "VirtualRun",
    "treadmill_running": "VirtualRun",
    "indoor_running": "VirtualRun",
    "cycling": "Ride",
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


def workout_to_props(user, ow_workout: dict) -> dict | None:
    """Map one Open Wearables workout onto Workout field values."""
    health_id = ow_workout.get("id")
    start_dt = _parse_dt(ow_workout.get("start_time"))
    if not health_id or start_dt is None:
        return None

    duration_s = ow_workout.get("duration_seconds")
    end_dt = _parse_dt(ow_workout.get("end_time"))
    if not duration_s and end_dt is not None:
        duration_s = max(int((end_dt - start_dt).total_seconds()), 0)
    if not duration_s:
        return None

    distance_m = ow_workout.get("distance_meters") or 0
    kcal = ow_workout.get("calories_kcal")
    avg_hr = ow_workout.get("avg_heart_rate_bpm")

    return {
        "user": user,
        "health_id": str(health_id),
        "sport_type": map_health_sport_type(ow_workout.get("type")),
        "start_datetime": start_dt,
        "duration": datetime.timedelta(seconds=int(duration_s)),
        "distance": None if not distance_m else round(float(distance_m) / 1000, 2),
        "kcal": None if kcal is None else round(float(kcal)),
        "intensity_category": _estimate_intensity(avg_hr, kcal, int(duration_s)),
    }


# ---------------------------------------------------------------------------
# Sync tasks
# ---------------------------------------------------------------------------

def _fetch_workouts(health_user_id: str, since: datetime.datetime) -> list:
    """All OW workouts for the user since ``since`` (cursor pagination)."""
    until = timezone.now() + datetime.timedelta(minutes=5)
    workouts, cursor = [], None
    while True:
        params = {
            "start_date": since.isoformat(),
            "end_date": until.isoformat(),
            "limit": 100,
        }
        if cursor:
            params["cursor"] = cursor
        page = _ow_request("GET", f"/users/{health_user_id}/events/workouts", params=params)
        if page is None:
            # OW 404: the user vanished server-side - treat as empty, the
            # caller decides whether to drop the linkage.
            return []
        items = page.get("data") or page.get("items") or []
        workouts.extend(items)
        cursor = page.get("next_cursor")
        if not cursor or not items:
            break
    return workouts


def _sync_user_workouts(user, start_datetime=None) -> dict:
    since = start_datetime or (timezone.now() - datetime.timedelta(days=3))
    ow_workouts = _fetch_workouts(user.health_user_id, since)

    existing = set(
        Workout.objects.filter(health_id__isnull=False).values_list("health_id", flat=True)
    )
    created = updated = skipped = duplicates = 0
    for ow_workout in ow_workouts:
        props = workout_to_props(user, ow_workout)
        if props is None:
            skipped += 1
            continue
        health_id = props["health_id"]
        if health_id in existing:
            workout = Workout.objects.filter(health_id=health_id).first()
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
def sync_health(self, user__id, start_datetime=None):
    CustomUser = get_user_model()
    user = CustomUser.objects.get(id=user__id)

    # One activity source per user: when another provider is selected,
    # Health must not import - the same activities would arrive twice.
    if user.get_activity_source() != 'health':
        logger.info("Health sync user %s skipped: Health is not the selected activity source", user__id)
        return {"user": user__id, "skipped": "health is not the selected activity source"}

    result = _sync_user_workouts(user, start_datetime=start_datetime)
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

    print(f"Syncing Health for {user_lst.count()} users")
    for user in user_lst:
        # Per-user throttle matching the hourly beat schedule (55 < 60 so
        # scheduler jitter can't push anyone to a two-hour cadence).
        if user.health_last_synced_at and user.health_last_synced_at > timezone.now() - datetime.timedelta(minutes=55):
            continue
        try:
            sync_health(user__id=user.id)
        except (HealthConfigError, HealthUnavailableError) as exc:
            print(f"Health sync failed for user {user.pk} - {exc}")
        except Exception as exc:  # noqa: BLE001 - never sink the whole sweep
            print(f"Health sync failed for user {user.pk} - {exc}")

    print("Finished syncing Health.")
    return "done"

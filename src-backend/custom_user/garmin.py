"""Garmin Connect integration.

Garmin has no open OAuth API for third-party hobby apps (the official
Health API is enterprise-only), so we use the widely-adopted
``garminconnect`` library which authenticates against Garmin Connect
with the user's credentials **once** and returns OAuth tokens.

Security model:
  - The Garmin password is used exactly once at link time to obtain
    tokens and is NEVER stored.
  - The OAuth token blob is stored encrypted at rest (Fernet, key
    derived from Django's SECRET_KEY - overridable via GARMIN_TOKEN_KEY).
  - Accounts with Garmin MFA (email/SMS code - forced on by Garmin for
    many devices) link via a two-step flow: the first call stashes the
    SSO session state in the cache and returns an mfa_token, the second
    call resumes the login with the code (see "MFA continuation").

Sync mirrors the Strava flow: recent activities are mapped onto
``workouts.Workout`` rows, de-duplicated by ``garmin_id``, with a daily
Celery beat job plus a manual (rate-limited) re-sync button.
"""

import datetime
import logging

from django.contrib.auth import get_user_model
from django.utils import timezone

from workout_challenge.celery import app, is_task_already_executing
from workouts.models import Workout, find_duplicate_workout
from workouts.sport_types import normalize_sport_type
from .token_crypto import decrypt_token, encrypt_token

logger = logging.getLogger(__name__)

MAX_HR_ESTIMATE = 180


# ---------------------------------------------------------------------------
# Token encryption (shared with the Strava integration - see token_crypto)
# ---------------------------------------------------------------------------

def encrypt_tokens(token_blob: str) -> str:
    return encrypt_token(token_blob)


def decrypt_tokens(enc_blob: str) -> str:
    return decrypt_token(enc_blob)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class GarminAuthError(Exception):
    """Bad credentials, MFA-required, or expired stored tokens."""


class GarminUnavailableError(Exception):
    """Network / Garmin-side failure."""


def _new_client(email=None, password=None):
    import garminconnect  # deferred import - heavy and only needed on demand
    return garminconnect.Garmin(email, password, return_on_mfa=True)


# ---------------------------------------------------------------------------
# MFA continuation
#
# Garmin now forces two-step verification (email/SMS code) on many
# accounts - for watches with health features it can't be disabled at
# all. The library completes MFA on the SAME client object that started
# the login (the SSO session lives in memory), so we serialise its MFA
# state into the cache for the few minutes between "password OK, code
# sent" and "user typed the code". The state contains live Garmin SSO
# cookies: cache-only, short TTL, single flow, never logged.
# ---------------------------------------------------------------------------
MFA_CACHE_PREFIX = "garmin-mfa:"
MFA_CACHE_TTL = 60 * 10  # codes live 30min, but the SSO session is short-lived


class GarminMfaRequired(Exception):
    """Password accepted, Garmin sent a verification code."""

    def __init__(self, mfa_token: str, method: str = "email"):
        super().__init__("MFA required")
        self.mfa_token = mfa_token
        self.method = method


def _dump_mfa_state(client, email: str) -> str:
    """Serialise the in-memory MFA state; returns the cache token."""
    import secrets

    import requests

    from django.core.cache import cache

    c = client.client  # vendored garminconnect.client.Client
    sess = getattr(c, "_mfa_session", None)
    if sess is None:
        raise GarminAuthError("Garmin asked for a code but left no session to resume.")
    cookies = sess.cookies
    if hasattr(cookies, "get_dict"):
        cookie_dict = cookies.get_dict()
    else:
        cookie_dict = requests.cookies.dict_from_cookiejar(cookies)
    widget_resp = getattr(c, "_widget_last_resp", None)
    state = {
        "email": email,
        "flow": getattr(c, "_mfa_flow", "portal"),
        "method": getattr(c, "_mfa_method", "email"),
        "login_params": getattr(c, "_mfa_login_params", {}) or {},
        "post_headers": getattr(c, "_mfa_post_headers", {}) or {},
        "service_url": getattr(c, "_mfa_service_url", None),
        "cookies": cookie_dict,
        "widget_resp_text": getattr(widget_resp, "text", None),
    }
    token = secrets.token_urlsafe(24)
    cache.set(MFA_CACHE_PREFIX + token, state, MFA_CACHE_TTL)
    return token


def _restore_mfa_client(token: str):
    """Rebuild a client positioned exactly after the password step."""
    import requests

    from django.core.cache import cache

    state = cache.get(MFA_CACHE_PREFIX + token)
    if not state:
        raise GarminAuthError("The verification session expired - please connect again.")
    client = _new_client()
    c = client.client
    sess = requests.Session()
    sess.cookies = requests.cookies.cookiejar_from_dict(state["cookies"])
    c._mfa_session = sess
    c._mfa_flow = state["flow"]
    c._mfa_method = state["method"]
    c._mfa_login_params = state["login_params"]
    c._mfa_post_headers = state["post_headers"]
    if state.get("service_url"):
        c._mfa_service_url = state["service_url"]
    if state.get("widget_resp_text"):
        # _complete_mfa_widget only parses the CSRF token out of .text.
        c._widget_last_resp = type("Resp", (), {"text": state["widget_resp_text"]})()
    return client


def complete_mfa_login(mfa_token: str, mfa_code: str) -> "tuple[str, str]":
    """Finish an MFA login with the emailed/SMSed code.

    Returns (token_blob, garmin_email) - the email rides in the cached
    state so the second request never has to repeat it.
    """
    import garminconnect

    from django.core.cache import cache

    state = cache.get(MFA_CACHE_PREFIX + mfa_token)
    if not state:
        raise GarminAuthError("The verification session expired - please connect again.")
    client = _restore_mfa_client(mfa_token)
    try:
        client.resume_login(None, mfa_code.strip())
    except garminconnect.GarminConnectAuthenticationError as exc:
        raise GarminAuthError("Garmin rejected the verification code.") from exc
    except garminconnect.GarminConnectTooManyRequestsError as exc:
        raise GarminUnavailableError("Garmin rate-limited the login - try again in a few minutes.") from exc
    except Exception as exc:  # noqa: BLE001
        raise GarminUnavailableError("Could not reach Garmin Connect. Please try again later.") from exc
    cache.delete(MFA_CACHE_PREFIX + mfa_token)
    return client.client.dumps(), state["email"]


def login_and_get_tokens(email: str, password: str) -> str:
    """Validate credentials against Garmin and return the token blob.

    Raises GarminAuthError for bad credentials / MFA accounts and
    GarminUnavailableError for network problems.
    """
    import garminconnect

    try:
        client = _new_client(email, password)
        needs_mfa, _ = client.login()
    except garminconnect.GarminConnectAuthenticationError as exc:
        raise GarminAuthError("Garmin rejected the email/password combination.") from exc
    except garminconnect.GarminConnectTooManyRequestsError as exc:
        raise GarminUnavailableError("Garmin rate-limited the login - try again in a few minutes.") from exc
    except Exception as exc:  # noqa: BLE001 - library raises broad requests errors
        raise GarminUnavailableError("Could not reach Garmin Connect. Please try again later.") from exc

    if needs_mfa:
        raise GarminMfaRequired(
            mfa_token=_dump_mfa_state(client, email),
            method=getattr(client.client, "_mfa_method", "email") or "email",
        )
    return client.client.dumps()


def get_client_for_user(user):
    """Resume a Garmin session from the stored (encrypted) tokens."""
    tokens = decrypt_tokens(user.garmin_tokens_enc)
    client = _new_client(email=user.garmin_email or None)
    try:
        client.login(tokens)
    except Exception as exc:  # noqa: BLE001
        raise GarminAuthError("Stored Garmin tokens expired - please re-link Garmin.") from exc
    return client


# ---------------------------------------------------------------------------
# Activity mapping
# ---------------------------------------------------------------------------

def map_sport_type(activity: dict) -> str:
    """Garmin typeKey -> app sport type via the SHARED normaliser
    (workouts.sport_types): Garmin, Health Connect and Strava must land
    the same physical activity on the same sport type, or the Echo
    families drift apart per source."""
    type_key = ((activity.get("activityType") or {}).get("typeKey") or "").lower()
    mapped, matched = normalize_sport_type(type_key)
    if not matched and type_key:
        # Unknown types fall back to the generic bucket - log them so a
        # new or renamed Garmin profile is visible (the 'cardio' gap
        # went unnoticed for months because the fallback was silent).
        logger.info("Garmin: unmapped activity type %r - imported as generic Workout", type_key)
    return mapped


# Garmin feed entries that are NOT workouts: some devices/loggers push
# all-day activity summaries (daily step counts) into the activity list.
# They must never become Workout rows - steps are a separate concept here
# (sport_type 'Steps' from manual entry / Health Connect, gated per goal
# by count_steps_as_walks). Exact matches only, so real step-*workouts*
# (stair stepper etc.) keep importing.
GARMIN_NON_WORKOUT_TYPES = {"steps", "daily_steps", "all_day_steps", "step_tracking"}


def is_non_workout_activity(activity: dict) -> bool:
    type_key = ((activity.get("activityType") or {}).get("typeKey") or "").lower()
    return type_key in GARMIN_NON_WORKOUT_TYPES


def _parse_start(activity: dict):
    raw = activity.get("startTimeGMT") or activity.get("startTimeLocal")
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


def activity_to_workout_props(user, activity: dict) -> dict | None:
    activity_id = activity.get("activityId")
    start_dt = _parse_start(activity)
    duration_s = activity.get("duration")
    if activity_id is None or start_dt is None or not duration_s:
        return None

    distance_m = activity.get("distance") or 0
    kcal = activity.get("activeKilocalories") or activity.get("calories")
    avg_hr = activity.get("averageHR") or activity.get("averageHeartRateInBeatsPerMinute")

    return {
        "user": user,
        "garmin_id": str(activity_id),
        "sport_type": map_sport_type(activity),
        "start_datetime": start_dt,
        "duration": datetime.timedelta(seconds=int(duration_s)),
        "distance": None if not distance_m else round(float(distance_m) / 1000, 2),
        "kcal": None if kcal is None else round(float(kcal)),
        "intensity_category": _estimate_intensity(avg_hr, kcal, int(duration_s)),
    }


# ---------------------------------------------------------------------------
# Sync tasks
# ---------------------------------------------------------------------------

# Hourly + manual re-sync window. Watches often sit unsynced for several
# days; 3 days dropped those activities forever after the initial 43-day
# import. 14 days still keeps the Garmin list call small.
RECENT_SYNC_DAYS = 14


def _sync_user_activities(user, days_back=RECENT_SYNC_DAYS) -> dict:
    """Fetch the last ``days_back`` days of activities for one user."""
    client = get_client_for_user(user)

    end = timezone.localdate()
    start = end - datetime.timedelta(days=days_back)
    try:
        activities = client.get_activities_by_date(
            startdate=start.isoformat(),
            enddate=end.isoformat(),
        )
    except GarminAuthError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise GarminUnavailableError("Could not fetch activities from Garmin.") from exc

    # Only the fetched page's ids - not the whole table's garmin rows
    # (which loaded every user's full Workout instances into memory
    # per user per hourly sync).
    activity_ids = [str(a.get("activityId")) for a in activities or [] if a.get("activityId") is not None]
    existing_map = Workout.objects.filter(garmin_id__in=activity_ids).in_bulk(field_name='garmin_id')
    created = updated = skipped = duplicates = removed = 0
    for activity in activities or []:
        if is_non_workout_activity(activity):
            # Never import step summaries - and remove the row again if a
            # previous sync already imported one (per-object delete so the
            # points recalc trigger fires).
            activity_id = activity.get("activityId")
            stale = existing_map.get(str(activity_id)) if activity_id is not None else None
            if stale is not None and stale.user_id == user.id:
                stale.delete()
                removed += 1
            else:
                skipped += 1
            continue
        props = activity_to_workout_props(user, activity)
        if props is None:
            skipped += 1
            continue
        garmin_id = props["garmin_id"]
        if garmin_id in existing_map:
            workout = existing_map[garmin_id]
            if workout is not None and workout.user_id == user.id:
                for key, value in props.items():
                    setattr(workout, key, value)
                workout.save()
                updated += 1
            continue
        # Cross-provider duplicate guard: the same activity may already
        # exist from Strava or as a manual entry - never import it twice.
        dup = find_duplicate_workout(
            user, props["start_datetime"], props["duration"],
            provider="garmin", sport_type=props.get("sport_type"),
        )
        if dup is not None:
            if not dup.garmin_id:
                dup.garmin_id = garmin_id
                dup.save(update_fields=["garmin_id"])
            duplicates += 1
            continue
        Workout.objects.create(**props)
        created += 1

    user.garmin_last_synced_at = timezone.now()
    user.save(update_fields=["garmin_last_synced_at"])
    return {"fetched": len(activities or []), "created": created, "updated": updated, "skipped": skipped, "duplicates_skipped": duplicates, "removed": removed}


@app.task(bind=True, time_limit=60 * 30)
def sync_garmin(self, user__id, days_back=RECENT_SYNC_DAYS):
    CustomUser = get_user_model()
    user = CustomUser.objects.get(id=user__id)

    # One activity source per user: when Strava is the selected provider,
    # Garmin must not import - the same activities would arrive twice.
    if user.get_activity_source() != 'garmin':
        logger.info("Garmin sync user %s skipped: Garmin is not the selected activity source", user__id)
        user.garmin_last_synced_at = timezone.now()
        user.save(update_fields=["garmin_last_synced_at"])
        return {"user": user__id, "skipped": "garmin is not the selected activity source"}

    result = _sync_user_activities(user, days_back=days_back)
    logger.info("Garmin sync user %s: %s", user__id, result)
    return {"user": user__id, **result}


@app.task(bind=True, time_limit=60 * 60 * 2, max_retries=3)
def daily_garmin_sync(self):
    if is_task_already_executing("daily_garmin_sync"):
        return "Task already executing. Skipping."

    CustomUser = get_user_model()
    user_lst = CustomUser.objects.filter(
        garmin_tokens_enc__isnull=False,
        is_active=True,
    ).exclude(garmin_tokens_enc="").order_by("garmin_last_synced_at", "pk")

    logger.info('Syncing Garmin for %s users', user_lst.count())
    for user in user_lst:
        # Per-user throttle matching the hourly beat schedule (55 < 60 so
        # scheduler jitter can't push anyone to a two-hour cadence).
        if user.garmin_last_synced_at and user.garmin_last_synced_at > timezone.now() - datetime.timedelta(minutes=55):
            continue
        try:
            sync_garmin(user__id=user.id, days_back=RECENT_SYNC_DAYS)
        except GarminAuthError as exc:
            # Tokens dead - clear the linkage so we stop hammering Garmin
            # and the user sees "not linked" in the UI.
            logger.warning("Garmin auth failed for %s (%s) - unlinking.", user.email, exc)
            user.garmin_tokens_enc = None
            user.garmin_email = None
            user.save()
        except Exception as exc:  # noqa: BLE001
            logger.exception('Garmin sync failed for user %s', user.pk)

    logger.info('Finished syncing Garmin.')
    return "done"

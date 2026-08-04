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
  - Accounts with Garmin MFA enabled can't be linked non-interactively
    yet; the link endpoint tells the user so explicitly.

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
        raise GarminAuthError(
            "This Garmin account has two-factor authentication enabled. "
            "Accounts with MFA can't be linked yet - please disable MFA in "
            "your Garmin account settings (or use Strava instead)."
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

GARMIN_SPORT_MAP = {
    "running": "Run",
    "trail_running": "TrailRun",
    "track_running": "Run",
    "treadmill_running": "VirtualRun",
    "indoor_running": "VirtualRun",
    "cycling": "Ride",
    "e_bike": "EBikeRide",
    "eBike": "EBikeRide",
    "gravel_cycling": "GravelRide",
    "mountain_biking": "MountainBikeRide",
    "e_mountain_biking": "EMountainBikeRide",
    "indoor_cycling": "VirtualRide",
    "virtual_ride": "VirtualRide",
    "walking": "Walk",
    "casual_walking": "Walk",
    "hiking": "Hike",
    "snowshoeing": "Snowshoe",
    "swimming": "Swim",
    "pool_swimming": "Swim",
    "open_water_swimming": "Swim",
    "rowing": "Rowing",
    "indoor_rowing": "VirtualRow",
    "kayaking": "Kayaking",
    "canoeing": "Canoeing",
    "stand_up_paddleboarding": "StandUpPaddling",
    "surfing": "Surfing",
    "windsurfing": "Windsurf",
    "kitesurfing": "Kitesurf",
    "sailing": "Sail",
    "resort_skiing": "AlpineSki",
    "resort_skiing_snowboarding": "AlpineSki",
    "backcountry_skiing": "BackcountrySki",
    "cross_country_skiing": "NordicSki",
    "skate_skiing": "NordicSki",
    "snowboarding": "Snowboard",
    "ice_skating": "IceSkate",
    "inline_skating": "InlineSkate",
    "skateboarding": "Skateboard",
    "elliptical": "Elliptical",
    "stair_climbing": "StairStepper",
    "stair_stepper": "StairStepper",
    "indoor_cardio": "HighIntensityIntervalTraining",
    "hiit": "HighIntensityIntervalTraining",
    "crossfit": "Crossfit",
    "strength_training": "WeightTraining",
    "pilates": "Pilates",
    "yoga": "Yoga",
    "rock_climbing": "RockClimbing",
    "bouldering": "RockClimbing",
    "soccer": "Soccer",
    "squash": "Squash",
    "badminton": "Badminton",
    "tennis": "Tennis",
    "table_tennis": "TableTennis",
    "pickleball": "Pickleball",
    "racquetball": "Racquetball",
    "golf": "Golf",
    "wheelchair": "Wheelchair",
}


def map_sport_type(activity: dict) -> str:
    type_key = ((activity.get("activityType") or {}).get("typeKey") or "").lower()
    return GARMIN_SPORT_MAP.get(type_key, "Workout")


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

def _sync_user_activities(user, days_back=3) -> dict:
    """Fetch the last ``days_back`` days of activities for one user."""
    client = get_client_for_user(user)

    end = datetime.date.today()
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

    existing = set(
        Workout.objects.filter(garmin_id__isnull=False).values_list("garmin_id", flat=True)
    )
    created = updated = skipped = duplicates = 0
    for activity in activities or []:
        props = activity_to_workout_props(user, activity)
        if props is None:
            skipped += 1
            continue
        garmin_id = props["garmin_id"]
        if garmin_id in existing:
            workout = Workout.objects.filter(garmin_id=garmin_id).first()
            if workout is not None and workout.user_id == user.id:
                for key, value in props.items():
                    setattr(workout, key, value)
                workout.save()
                updated += 1
            continue
        # Cross-provider duplicate guard: the same activity may already
        # exist from Strava or as a manual entry - never import it twice.
        if find_duplicate_workout(user, props["start_datetime"], props["duration"], provider="garmin") is not None:
            duplicates += 1
            continue
        Workout.objects.create(**props)
        created += 1

    user.garmin_last_synced_at = timezone.now()
    user.save(update_fields=["garmin_last_synced_at"])
    return {"fetched": len(activities or []), "created": created, "updated": updated, "skipped": skipped, "duplicates_skipped": duplicates}


@app.task(bind=True, time_limit=60 * 30)
def sync_garmin(self, user__id, days_back=3):
    CustomUser = get_user_model()
    user = CustomUser.objects.get(id=user__id)

    # One activity source per user: when Strava is the selected provider,
    # Garmin must not import - the same activities would arrive twice.
    if user.get_activity_source() != 'garmin':
        logger.info("Garmin sync user %s skipped: Garmin is not the selected activity source", user__id)
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

    print(f"Syncing Garmin for {user_lst.count()} users")
    for user in user_lst:
        # Per-user throttle matching the hourly beat schedule (55 < 60 so
        # scheduler jitter can't push anyone to a two-hour cadence).
        if user.garmin_last_synced_at and user.garmin_last_synced_at > timezone.now() - datetime.timedelta(minutes=55):
            continue
        try:
            sync_garmin(user__id=user.id, days_back=3)
        except GarminAuthError as exc:
            # Tokens dead - clear the linkage so we stop hammering Garmin
            # and the user sees "not linked" in the UI.
            logger.warning("Garmin auth failed for %s (%s) - unlinking.", user.email, exc)
            user.garmin_tokens_enc = None
            user.garmin_email = None
            user.save()
        except Exception as exc:  # noqa: BLE001
            print(f"Garmin sync failed for user {user.email} - {exc}")

    print("Finished syncing Garmin.")
    return "done"

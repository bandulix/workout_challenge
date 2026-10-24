"""What each linked source can actually provide, and parsers that reduce
provider payloads to one number per day.

Nothing in here stores a sample. Callers persist the dicts these
functions return and throw the payload away.

Researched against the integrations already in this repo:

* Garmin Connect, via ``garminconnect`` 0.3.2 (session token, not OAuth).
  Wellness reads exist on the same login the activity sync already
  holds. There is no extra OAuth scope to request; the opt-in is our
  own consent switch, and we do not call these methods until it is on.
  Methods: ``get_sleep_data``, ``get_hrv_data``, ``get_stats``
  (``restingHeartRate``), ``get_body_battery``, ``get_training_readiness``,
  ``get_all_day_stress`` / ``get_stress_data``.
* Apple Health and Health Connect, via the Open Wearables summaries
  the health connector already polls (``custom_user.health``):
  ``GET /users/{id}/summaries/sleep`` (nightly duration, efficiency,
  ``avg_hrv_rmssd_ms``, ``avg_hrv_sdnn_ms``) and
  ``GET /users/{id}/timeseries?types=resting_heart_rate&resolution=1hour``
  reduced to a daily median. Garmin Body Battery, training readiness
  and stress, when a provider has pushed them, come from
  ``GET /users/{id}/health-scores`` (categories ``body_battery``,
  ``readiness``, ``stress``) as one score per day.
  Health Connect on Android does not receive those Garmin scores.
  The Android SDK type ids we request only after opt-in are
  ``sleep``, ``restingHeartRate`` and ``heartRateVariabilitySDNN``
  (the id the Open Wearables Android SDK publishes). Health Connect's
  own record is RMSSD; the coverage matrix says Health Connect supplies
  ``heart_rate_variability_rmssd`` and not SDNN. We store whichever
  nightly average the sleep summary actually returns and never mix the
  two metrics in one baseline. Apple HealthKit's native HRV is SDNN
  (``HKQuantityTypeIdentifierHeartRateVariabilitySDNN``); the same
  sleep-summary field carries it. iOS permission prompts live in the
  Open Wearables health app, not in this Android project.
* Strava has no sleep, HRV, resting heart rate, Body Battery or stress
  scope. ``activity:read`` / ``activity:read_all`` are workouts.
  Intra-activity heart-rate streams are not recovery and are not read.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone

from .score import (
    as_number,
    in_bounds,
    median,
    readiness_date_for_sleep,
)

SCOPE_SLEEP = "sleep"
SCOPE_HRV = "hrv"
SCOPE_RHR = "resting_hr"
SCOPE_BODY_BATTERY = "body_battery"
SCOPE_READINESS = "training_readiness"
SCOPE_STRESS = "stress"

ALL_SCOPES = (
    SCOPE_SLEEP,
    SCOPE_HRV,
    SCOPE_RHR,
    SCOPE_BODY_BATTERY,
    SCOPE_READINESS,
    SCOPE_STRESS,
)

GARMIN_SCOPES = ALL_SCOPES
HEALTH_SCOPES = (SCOPE_SLEEP, SCOPE_HRV, SCOPE_RHR)

CONSENT_VERSION = "1"
CONSENT_TEXT = (
    "Readiness reads daily summaries only: last night's sleep, overnight HRV, "
    "resting heart rate, and — only if Garmin has them — Body Battery, training "
    "readiness and average stress. Strava cannot supply any of these, so it is "
    "not used. Heart-rate streams, GPS and beat-by-beat data are not stored. "
    "This is a training hint, not medical advice. You can turn it off and delete "
    "every stored day."
)

SOURCE_NOTES = {
    "strava": {
        "label": "Strava",
        "scopes": [],
        "note": (
            "Strava's API is activities only (activity:read / activity:read_all). "
            "It has no sleep, HRV, resting heart rate, Body Battery or stress scope. "
            "We do not request any new Strava scope for readiness, and we do not "
            "read activity heart-rate streams."
        ),
    },
    "garmin": {
        "label": "Garmin Connect",
        "scopes": list(GARMIN_SCOPES),
        "note": (
            "The Garmin login this app already stores can read wellness "
            "(sleep, overnight HRV, resting heart rate, Body Battery, training "
            "readiness, average stress). Garmin has no hobby-app OAuth scope "
            "for these; they stay off until you opt in here. Only the daily "
            "number is kept."
        ),
    },
    "health_connect": {
        "label": "Health Connect",
        "scopes": list(HEALTH_SCOPES),
        "note": (
            "Sleep is already a Health Connect type this app can request. "
            "Resting heart rate and HRV are a separate opt-in "
            "(restingHeartRate, heartRateVariabilitySDNN). Health Connect's "
            "HRV record is RMSSD. Body Battery and Garmin training readiness "
            "are not Health Connect types."
        ),
    },
    "apple_health": {
        "label": "Apple Health",
        "scopes": list(HEALTH_SCOPES),
        "note": (
            "Apple Health reaches this server through the same Open Wearables "
            "path as Health Connect. Sleep, resting heart rate and HRV (SDNN, "
            "which is what HealthKit records) are read as nightly summaries "
            "when the health app on the phone has those types enabled. "
            "There is no Body Battery on Apple Health."
        ),
    },
}


def _first(payload, *keys):
    if not isinstance(payload, dict):
        return None
    for key in keys:
        if payload.get(key) not in (None, ""):
            return payload.get(key)
    return None


def parse_garmin_sleep(payload) -> dict:
    """One night from ``get_sleep_data``. Series inside the payload are ignored."""
    dto = {}
    if isinstance(payload, dict):
        dto = payload.get("dailySleepDTO") if isinstance(payload.get("dailySleepDTO"), dict) else payload
    raw = as_number(_first(dto, "sleepTimeSeconds", "sleepTime"))
    # Garmin sends seconds (a night is thousands). A value already in
    # the 90–720 minute band is accepted as minutes. Anything else is
    # not a main night.
    if raw is None:
        minutes = None
    elif raw >= 90 * 60:
        minutes = raw / 60
    elif 90 <= raw <= 720:
        minutes = raw
    else:
        minutes = None
    scores = dto.get("sleepScores") if isinstance(dto, dict) else None
    overall = None
    if isinstance(scores, dict):
        raw_overall = scores.get("overall")
        if isinstance(raw_overall, dict):
            overall = as_number(raw_overall.get("value"))
        else:
            overall = as_number(raw_overall)
    if overall is None and isinstance(dto, dict):
        overall = as_number(_first(dto, "sleepScore", "overallScore"))
    quality = in_bounds(overall, 0, 100)
    rhr = in_bounds(_first(dto, "restingHeartRate") if isinstance(dto, dict) else None, 30, 110)
    sleep_minutes = None
    if minutes is not None:
        bounded = in_bounds(minutes, 90, 720)
        sleep_minutes = None if bounded is None else int(round(bounded))
    return {
        "sleep_minutes": sleep_minutes,
        "sleep_quality": None if quality is None else int(round(quality)),
        "resting_hr": None if rhr is None else int(round(rhr)),
    }


def parse_garmin_hrv(payload) -> dict:
    summary = payload.get("hrvSummary") if isinstance(payload, dict) and isinstance(payload.get("hrvSummary"), dict) else payload
    if not isinstance(summary, dict):
        return {"hrv_ms": None, "hrv_metric": "garmin"}
    value = in_bounds(_first(summary, "lastNightAvg", "lastNight", "weeklyAvg"), 5, 200)
    # weeklyAvg is a baseline, not last night. Prefer lastNightAvg only.
    if isinstance(payload, dict) and isinstance(payload.get("hrvSummary"), dict):
        value = in_bounds(payload["hrvSummary"].get("lastNightAvg"), 5, 200)
    return {
        "hrv_ms": None if value is None else round(value, 1),
        "hrv_metric": "garmin",
    }


def parse_garmin_stats_rhr(payload) -> int | None:
    if not isinstance(payload, dict):
        return None
    value = in_bounds(_first(payload, "restingHeartRate", "restingHR"), 30, 110)
    if value is None:
        return None
    return int(round(value))


def _battery_levels(payload) -> list[float]:
    rows = payload if isinstance(payload, list) else [payload]
    levels = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        series = row.get("bodyBatteryValuesArray") or row.get("bodyBatteryValues") or []
        if isinstance(series, list):
            for point in series:
                if isinstance(point, (list, tuple)) and len(point) >= 2:
                    level = as_number(point[1])
                elif isinstance(point, dict):
                    level = as_number(_first(point, "level", "value"))
                else:
                    level = None
                if level is not None and 0 <= level <= 100:
                    levels.append(level)
        charged = as_number(row.get("charged"))
        if charged is not None and 0 <= charged <= 100 and not levels:
            levels.append(charged)
    return levels


def parse_garmin_body_battery(payload) -> int | None:
    """The day's peak charge (the morning high), not the time series."""
    levels = _battery_levels(payload)
    if not levels:
        return None
    return int(round(max(levels)))


def parse_garmin_readiness(payload) -> int | None:
    row = payload[0] if isinstance(payload, list) and payload else payload
    if not isinstance(row, dict):
        return None
    value = in_bounds(_first(row, "trainingReadinessScore", "score", "value"), 0, 100)
    if value is None:
        return None
    return int(round(value))


def parse_garmin_stress(payload) -> int | None:
    """Average stress only. A values array is reduced to its mean and dropped."""
    if isinstance(payload, list):
        payload = payload[0] if payload else None
    if not isinstance(payload, dict):
        return None
    average = in_bounds(_first(payload, "avgStressLevel", "averageStressLevel", "overallStressLevel"), 0, 100)
    if average is not None:
        return int(round(average))
    series = payload.get("stressValuesArray") or payload.get("stressValues") or []
    samples = []
    if isinstance(series, list):
        for point in series:
            raw = point[1] if isinstance(point, (list, tuple)) and len(point) >= 2 else point
            number = as_number(raw if not isinstance(raw, dict) else _first(raw, "value", "stressLevel"))
            if number is not None and 0 <= number <= 100:
                samples.append(number)
    if not samples:
        return None
    return int(round(sum(samples) / len(samples)))


def _parse_instant(raw):
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt_timezone.utc)
    return parsed


def _provider_source(row) -> str:
    source = row.get("source") if isinstance(row, dict) else None
    provider = ""
    if isinstance(source, dict):
        provider = str(source.get("provider") or "")
    elif isinstance(row, dict):
        provider = str(row.get("provider") or "")
    provider = provider.lower()
    if provider in {"apple", "apple_health", "healthkit"}:
        return "apple_health"
    if provider in {"health_connect", "google", "google_health"}:
        return "health_connect"
    if provider == "garmin":
        return "garmin"
    return "health_connect"


def parse_ow_sleep_row(row, tz) -> dict | None:
    """One Open Wearables sleep-summary day. Stage intervals are not read."""
    if not isinstance(row, dict):
        return None
    end = _parse_instant(row.get("end_time") or row.get("end"))
    if end is not None:
        day = readiness_date_for_sleep(end, tz)
    else:
        raw_date = str(row.get("date") or "")[:10]
        try:
            day = datetime.fromisoformat(raw_date).date()
        except ValueError:
            return None
    minutes = as_number(row.get("duration_minutes"))
    if minutes is None:
        minutes = as_number(row.get("total_duration_minutes"))
    bounded = in_bounds(minutes, 90, 720)
    rmssd = in_bounds(row.get("avg_hrv_rmssd_ms"), 5, 200)
    sdnn = in_bounds(row.get("avg_hrv_sdnn_ms"), 5, 250)
    if rmssd is not None:
        hrv_ms, hrv_metric = round(rmssd, 1), "rmssd"
    elif sdnn is not None:
        hrv_ms, hrv_metric = round(sdnn, 1), "sdnn"
    else:
        hrv_ms, hrv_metric = None, ""
    quality = in_bounds(row.get("efficiency_percent"), 0, 100)
    return {
        "date": day,
        "source": _provider_source(row),
        "sleep_minutes": None if bounded is None else int(round(bounded)),
        "sleep_quality": None if quality is None else int(round(quality)),
        "hrv_ms": hrv_ms,
        "hrv_metric": hrv_metric,
    }


def daily_resting_hr(points, tz) -> dict:
    """Median resting heart rate per local date. The hourly buckets are not returned."""
    buckets: dict = {}
    for point in points or []:
        if not isinstance(point, dict):
            continue
        kind = str(point.get("type") or point.get("metric") or "resting_heart_rate")
        if kind not in {"resting_heart_rate", "restingHeartRate"}:
            continue
        instant = _parse_instant(point.get("timestamp") or point.get("recorded_at") or point.get("time") or point.get("start_time"))
        value = in_bounds(point.get("value") if "value" in point else point.get("resting_heart_rate_bpm"), 30, 110)
        if instant is None or value is None:
            continue
        day = instant.astimezone(tz).date()
        buckets.setdefault(day, []).append(value)
    return {day: int(round(median(values))) for day, values in buckets.items() if median(values) is not None}


def parse_health_score_rows(rows) -> dict:
    """``{date: {body_battery|training_readiness|stress: int}}`` from health-scores."""
    wanted = {
        "body_battery": "body_battery",
        "garmin_body_battery": "body_battery",
        "readiness": "training_readiness",
        "training_readiness": "training_readiness",
        "recovery": "training_readiness",
        "stress": "stress",
    }
    out: dict = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        category = str(row.get("category") or row.get("score_type") or row.get("type") or "").lower()
        field = wanted.get(category)
        if field is None:
            continue
        raw_date = str(row.get("date") or row.get("recorded_at") or row.get("timestamp") or "")[:10]
        try:
            day = datetime.fromisoformat(raw_date).date()
        except ValueError:
            instant = _parse_instant(row.get("recorded_at") or row.get("timestamp"))
            if instant is None:
                continue
            day = instant.date()
        value = in_bounds(row.get("score") if row.get("score") is not None else row.get("value"), 0, 100)
        if value is None:
            continue
        out.setdefault(day, {})[field] = int(round(value))
    return out


def merge_day(base: dict, incoming: dict, *, incoming_priority: int, base_priority: int) -> dict:
    """Fill a day's aggregate. A higher-priority source (lower number)
    overwrites; a lower-priority source only fills blanks. HRV is replaced
    only as a pair with its metric so RMSSD and SDNN are never averaged.
    """
    merged = dict(base)
    overwrite = incoming_priority <= base_priority
    for key in ("sleep_minutes", "sleep_quality", "resting_hr", "body_battery", "training_readiness", "stress_avg"):
        value = incoming.get(key)
        if value is None:
            continue
        if overwrite or merged.get(key) is None:
            merged[key] = value
    if incoming.get("hrv_ms") is not None:
        if overwrite or merged.get("hrv_ms") is None:
            merged["hrv_ms"] = incoming["hrv_ms"]
            merged["hrv_metric"] = incoming.get("hrv_metric") or merged.get("hrv_metric") or ""
    if overwrite and incoming.get("source"):
        merged["source"] = incoming["source"]
    elif not merged.get("source"):
        merged["source"] = incoming.get("source") or ""
    return merged


def window_start(today, days):
    return today - timedelta(days=days)

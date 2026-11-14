"""Optional elevation and run counts shared by the import connectors."""


_ELEVATION_KEYS = (
    "total_elevation_gain",
    "totalElevationGainInMeters",
    "elevationGainInMeters",
    "elevationGain",
    "elevation_gain",
    "elevation_gain_m",
    "total_elevation_gain_m",
    "elevation_meters",
    "totalAscent",
    "total_ascent",
)
_RUN_KEYS = ("runs", "numberOfRuns", "runCount", "totalRuns", "total_runs")


def _as_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first(payload, keys, caster):
    if not isinstance(payload, dict):
        return None
    for key in keys:
        number = caster(payload.get(key))
        if number is None:
            continue
        return number
    return None


def optional_activity_metrics(payload):
    """Elevation (metres) and runs when the provider sent them.

    Missing keys are omitted so an update does not wipe a value the
    athlete typed in. Zero is kept: a flat ski day is still a ski day.
    """
    elevation = _first(payload, _ELEVATION_KEYS, _as_float)
    runs = _first(payload, _RUN_KEYS, _as_float)
    out = {}
    if elevation is not None and 0 <= elevation <= 20000:
        out["elevation_m"] = round(elevation, 1)
    if runs is not None and 0 <= runs <= 500:
        out["runs"] = int(runs)
    return out

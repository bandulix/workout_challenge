"""Curated Alpine ski resorts and free-text geocoding fallback.

Coordinates are the village (valley weather). Summit elevation is the
high point of the ski area, used as the Berg snow/temperature sample.
"""

import logging

import requests

logger = logging.getLogger(__name__)

# lat, lon, valley m, summit m, timezone
_RAW = (
    ("zermatt", "Zermatt", 46.02071, 7.74913, 1620, 3883, "Europe/Zurich"),
    ("st-moritz", "St. Moritz", 46.49080, 9.83551, 1822, 3303, "Europe/Zurich"),
    ("davos", "Davos", 46.80274, 9.83603, 1560, 2844, "Europe/Zurich"),
    ("verbier", "Verbier", 46.09610, 7.22856, 1500, 3330, "Europe/Zurich"),
    ("engelberg", "Engelberg", 46.82100, 8.40140, 1000, 3020, "Europe/Zurich"),
    ("grindelwald", "Grindelwald", 46.62416, 8.04112, 1034, 2971, "Europe/Zurich"),
    ("wengen", "Wengen", 46.60600, 7.92100, 1274, 2320, "Europe/Zurich"),
    ("saas-fee", "Saas-Fee", 46.10860, 7.92920, 1800, 3600, "Europe/Zurich"),
    ("laax", "Laax", 46.80400, 9.25700, 1100, 3018, "Europe/Zurich"),
    ("crans-montana", "Crans-Montana", 46.31100, 7.48100, 1500, 3000, "Europe/Zurich"),
    ("andermatt", "Andermatt", 46.63600, 8.59300, 1444, 2961, "Europe/Zurich"),
    ("st-anton", "St. Anton", 47.12750, 10.26820, 1304, 2811, "Europe/Vienna"),
    ("lech", "Lech", 47.20800, 10.14200, 1450, 2450, "Europe/Vienna"),
    ("ischgl", "Ischgl", 47.01200, 10.29200, 1400, 2872, "Europe/Vienna"),
    ("kitzbuehel", "Kitzbühel", 47.44640, 12.39190, 762, 2005, "Europe/Vienna"),
    ("soelden", "Sölden", 46.96550, 11.00760, 1368, 3250, "Europe/Vienna"),
    ("chamonix", "Chamonix", 45.92370, 6.86940, 1035, 3842, "Europe/Paris"),
    ("val-disere", "Val d'Isère", 45.44810, 6.98000, 1850, 3456, "Europe/Paris"),
    ("tignes", "Tignes", 45.46920, 6.90900, 1550, 3456, "Europe/Paris"),
    ("courchevel", "Courchevel", 45.41500, 6.63470, 1300, 2738, "Europe/Paris"),
    ("val-thorens", "Val Thorens", 45.29780, 6.58020, 2300, 3230, "Europe/Paris"),
    ("megeve", "Megève", 45.85660, 6.61770, 1113, 2350, "Europe/Paris"),
    ("cortina", "Cortina d'Ampezzo", 46.53690, 12.13570, 1224, 3244, "Europe/Rome"),
    ("cervinia", "Cervinia", 45.93360, 7.63000, 2050, 3480, "Europe/Rome"),
    ("livigno", "Livigno", 46.53800, 10.13580, 1816, 2800, "Europe/Rome"),
    ("madonna-di-campiglio", "Madonna di Campiglio", 46.23000, 10.82600, 1550, 2500, "Europe/Rome"),
)

ALPINE_RESORTS = tuple(
    {
        "slug": slug,
        "name": name,
        "latitude": lat,
        "longitude": lon,
        "valley_elevation_m": valley,
        "summit_elevation_m": summit,
        "timezone": tz,
    }
    for slug, name, lat, lon, valley, summit, tz in _RAW
)
RESORTS_BY_SLUG = {row["slug"]: row for row in ALPINE_RESORTS}

# Rough Alpine box so a free-text hit in Florida is not a ski week.
_ALPINE_LAT = (43.4, 48.9)
_ALPINE_LON = (4.4, 16.8)


class ResortError(ValueError):
    pass


def public_resort_list():
    return [
        {
            "slug": row["slug"],
            "name": row["name"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "valley_elevation_m": row["valley_elevation_m"],
            "summit_elevation_m": row["summit_elevation_m"],
            "timezone": row["timezone"],
        }
        for row in ALPINE_RESORTS
    ]


def _in_alps(lat, lon):
    return _ALPINE_LAT[0] <= lat <= _ALPINE_LAT[1] and _ALPINE_LON[0] <= lon <= _ALPINE_LON[1]


def match_catalog(query):
    text = " ".join((query or "").split()).strip().lower()
    if not text:
        return None
    for row in ALPINE_RESORTS:
        if text == row["slug"] or text == row["name"].lower():
            return row
    for row in ALPINE_RESORTS:
        if text in row["name"].lower() or row["name"].lower() in text:
            return row
    return None


def geocode_alpine(query, *, getter=None):
    """Resolve a free-text resort inside the Alps. Catalog hits skip the network."""
    known = match_catalog(query)
    if known:
        return known
    text = " ".join((query or "").split()).strip()
    if len(text) < 2:
        raise ResortError("Pick an Alpine resort.")
    getter = getter or requests.get
    try:
        response = getter(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": text, "count": 5, "language": "en", "format": "json"},
            timeout=6,
            headers={"User-Agent": "WorkoutChallenge/skiweek"},
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        logger.info("Ski resort geocoding failed: %s", exc)
        raise ResortError("Could not look up that resort. Pick one from the list.") from exc
    results = payload.get("results") or []
    alpine = []
    for row in results:
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if _in_alps(lat, lon):
            alpine.append(row)
    if not alpine:
        raise ResortError("That place is outside the Alps. Pick a resort from the list.")
    hit = alpine[0]
    elevation = hit.get("elevation")
    valley = int(elevation) if isinstance(elevation, (int, float)) else None
    summit = valley + 1200 if valley is not None else None
    return {
        "slug": "",
        "name": hit.get("name") or text,
        "latitude": float(hit["latitude"]),
        "longitude": float(hit["longitude"]),
        "valley_elevation_m": valley,
        "summit_elevation_m": summit,
        "timezone": "Europe/Zurich",
    }


def resolve_resort(*, slug="", query="", getter=None):
    slug = (slug or "").strip()
    if slug:
        row = RESORTS_BY_SLUG.get(slug)
        if row is None:
            raise ResortError("Unknown ski resort.")
        return row
    if (query or "").strip():
        return geocode_alpine(query, getter=getter)
    raise ResortError("Pick an Alpine resort.")

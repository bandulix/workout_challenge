"""Ski week resort days, Sambuca logs, crowns, scoring, and snow."""

import datetime
import logging
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from django.apps import apps
from django.core.cache import cache
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

logger = logging.getLogger(__name__)

SKI_SPORTS = ("AlpineSki", "Snowboard", "BackcountrySki", "NordicSki", "Snowshoe")
KIND_SAMBUCA = "sambuca"
KIND_WATER = "water"
# A typical goal scores 1 point per 1% (so a full goal is ~100 points
# before the sport factor). Five points per Sambuca is visible on the
# board and still smaller than a ski day.
DEFAULT_POINTS_PER_SAMBUCA = Decimal("5.00")
SOFT_CONFIRM_AT = 8
SIP_AMOUNT_MAX = 3
WEATHER_TTL = 45 * 60
WEATHER_ATTRIBUTION = "Weather and snow: Open-Meteo.com"

# Copy never tells anyone to drink more.
SOFT_CONFIRM_DETAIL = "That's a high count for one resort day. Save it only if it's right."


class SkiWeekError(Exception):
    def __init__(self, message, *, code="invalid", status=400, extra=None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra or {}


def zone(name):
    try:
        return ZoneInfo(name or "Europe/Zurich")
    except ZoneInfoNotFoundError:
        return ZoneInfo("Europe/Zurich")


def as_aware(when):
    if when is None:
        when = timezone.now()
    if timezone.is_naive(when):
        when = timezone.make_aware(when, datetime.timezone.utc)
    return when


def resort_day(when, tz_name, cutoff_hour):
    """Calendar date the resort assigns to ``when``.

    Hours before ``cutoff_hour`` still belong to the previous evening,
    so a 02:00 Sambuca counts for the day that just ended.
    """
    local = as_aware(when).astimezone(zone(tz_name))
    day = local.date()
    if local.hour < int(cutoff_hour):
        day -= datetime.timedelta(days=1)
    return day


def resort_day_window(tz_name, cutoff_hour, day):
    """Half-open [cutoff, next cutoff) in the resort timezone."""
    start = datetime.datetime.combine(day, datetime.time(hour=int(cutoff_hour)), tzinfo=zone(tz_name))
    return start, start + datetime.timedelta(days=1)


def next_cutoff(when, tz_name, cutoff_hour):
    local = as_aware(when).astimezone(zone(tz_name))
    day = local.date()
    cutoff = datetime.datetime.combine(day, datetime.time(hour=int(cutoff_hour)), tzinfo=zone(tz_name))
    if local >= cutoff:
        cutoff += datetime.timedelta(days=1)
    return cutoff


def enabled_campaign(competition_id):
    from .models import SkiWeekCampaign
    return (
        SkiWeekCampaign.objects.filter(competition_id=competition_id, enabled=True)
        .select_related("competition")
        .first()
    )


def _participants(competition):
    return list(competition.user.all().only("id", "username"))


def _names(user_ids):
    CustomUser = apps.get_model("custom_user", "CustomUser")
    return {
        row["id"]: row["username"]
        for row in CustomUser.objects.filter(pk__in=list(user_ids)).values("id", "username")
    }


def daily_amounts(campaign, day, kind):
    from .models import SambucaEntry
    rows = (
        SambucaEntry.objects.filter(campaign=campaign, resort_day=day, kind=kind)
        .values("user_id")
        .annotate(total=Sum("amount"))
        .order_by("-total", "user_id")
    )
    return [(row["user_id"], int(row["total"] or 0)) for row in rows]


def log_sip(campaign, user, *, amount, kind=KIND_SAMBUCA, when=None, confirm=False, photo=None):
    from .models import SambucaEntry, SambucaSettlement

    amount = int(amount)
    if amount < 1 or amount > SIP_AMOUNT_MAX:
        raise SkiWeekError("Add 1, 2, or 3 at a time.")
    if kind not in (KIND_SAMBUCA, KIND_WATER):
        raise SkiWeekError("Unknown counter.")
    if kind == KIND_WATER and not campaign.water_enabled:
        raise SkiWeekError("The water counter is off for this ski week.")
    if not campaign.enabled:
        raise SkiWeekError("This ski week is off.")
    when = as_aware(when)
    day = resort_day(when, campaign.timezone, campaign.day_cutoff_hour)
    start = campaign.competition.start_date
    end = campaign.competition.end_date
    if day < start or day > end:
        raise SkiWeekError("The ski week is not running that day.")
    if SambucaSettlement.objects.filter(campaign=campaign, resort_day=day).exists():
        raise SkiWeekError("That resort day is already settled.", code="settled", status=409)

    current = 0
    if kind == KIND_SAMBUCA:
        for uid, total in daily_amounts(campaign, day, KIND_SAMBUCA):
            if uid == user.id:
                current = total
                break
        next_total = current + amount
        if next_total >= SOFT_CONFIRM_AT and not confirm:
            raise SkiWeekError(
                SOFT_CONFIRM_DETAIL,
                code="confirm_sambuca",
                status=409,
                extra={
                    "daily_total": current,
                    "next_total": next_total,
                    "soft_confirm_at": SOFT_CONFIRM_AT,
                },
            )

    entry = SambucaEntry(
        campaign=campaign,
        user=user,
        kind=kind,
        amount=amount,
        logged_at=when,
        resort_day=day,
    )
    if photo is not None:
        entry.photo = photo
    entry.save()
    _bump(campaign)
    return entry


def undo_last_sip(campaign, user, *, kind=KIND_SAMBUCA):
    from .models import SambucaEntry, SambucaSettlement

    entry = (
        SambucaEntry.objects.filter(campaign=campaign, user=user, kind=kind)
        .order_by("-logged_at", "-id")
        .first()
    )
    if entry is None:
        raise SkiWeekError("Nothing to undo.", status=404)
    if SambucaSettlement.objects.filter(campaign=campaign, resort_day=entry.resort_day).exists():
        raise SkiWeekError("That resort day is already settled.", code="settled", status=409)
    entry.delete()
    _bump(campaign)
    return entry


def _bump(campaign):
    from custom_user.point_recalc import bump_stats_generation
    bump_stats_generation([campaign.competition_id])


def leaders_for(rows):
    """All users tied for the highest positive total."""
    positive = [(uid, total) for uid, total in rows if total > 0]
    if not positive:
        return [], 0
    top = max(total for _uid, total in positive)
    winners = [(uid, total) for uid, total in positive if total == top]
    return winners, top


def settle_resort_day(campaign, day):
    """Freeze one resort day. Every user tied for the top count wears the crown."""
    from .models import SambucaCrown, SambucaSettlement

    if SambucaSettlement.objects.filter(campaign=campaign, resort_day=day).exists():
        return None
    winners, top = leaders_for(daily_amounts(campaign, day, KIND_SAMBUCA))
    with transaction.atomic():
        settlement, created = SambucaSettlement.objects.get_or_create(
            campaign=campaign,
            resort_day=day,
            defaults={"winning_count": top},
        )
        if not created:
            return None
        if settlement.winning_count != top:
            settlement.winning_count = top
            settlement.save(update_fields=["winning_count"])
        for uid, _total in winners:
            SambucaCrown.objects.get_or_create(settlement=settlement, user_id=uid)
    return settlement


def settle_due_crowns(now=None):
    """Settle every resort day that has already crossed its cutoff."""
    from .models import SkiWeekCampaign

    now = as_aware(now)
    settled = []
    for campaign in SkiWeekCampaign.objects.filter(enabled=True).select_related("competition"):
        current = resort_day(now, campaign.timezone, campaign.day_cutoff_hour)
        start = campaign.competition.start_date
        end = min(campaign.competition.end_date, current - datetime.timedelta(days=1))
        if end < start:
            continue
        from .models import SambucaSettlement
        existing = set(
            SambucaSettlement.objects.filter(
                campaign=campaign, resort_day__gte=start, resort_day__lte=end,
            ).values_list("resort_day", flat=True)
        )
        day = start
        while day <= end:
            if day not in existing:
                row = settle_resort_day(campaign, day)
                if row is not None:
                    settled.append(row.pk)
            day += datetime.timedelta(days=1)
    return {"settled": len(settled), "ids": settled}


def sambuca_points_by_user(competition_id, *, day_from=None, day_to=None):
    """Sambuca points for an enabled ski week, or None when there isn't one.

    Points are ``amount * points_per_sambuca``. Water never scores.
    """
    from .models import SambucaEntry

    campaign = enabled_campaign(competition_id)
    if campaign is None:
        return None
    qs = SambucaEntry.objects.filter(campaign=campaign, kind=KIND_SAMBUCA)
    if day_from is not None:
        qs = qs.filter(resort_day__gte=day_from)
    if day_to is not None:
        qs = qs.filter(resort_day__lte=day_to)
    rate = campaign.points_per_sambuca or Decimal("0")
    per_user = {}
    per_user_day = {}
    today = timezone.localdate()
    for row in qs.values("user_id", "resort_day").annotate(amount=Sum("amount")):
        pts = (Decimal(row["amount"] or 0) * rate).quantize(Decimal("0.01"))
        uid = row["user_id"]
        per_user[uid] = per_user.get(uid, Decimal("0")) + pts
        days_ago = (today - row["resort_day"]).days
        if days_ago < 0:
            continue
        bucket = per_user_day.setdefault(uid, {})
        bucket[days_ago] = bucket.get(days_ago, Decimal("0")) + pts

    Team = apps.get_model("competition", "Team")
    per_team = {}
    user_team = {}
    for team in Team.objects.filter(competition_id=competition_id).prefetch_related("user"):
        total = Decimal("0")
        for member in team.user.all():
            user_team.setdefault(member.id, team.id)
            total += per_user.get(member.id, Decimal("0"))
        per_team[team.id] = total
    return {
        "campaign": campaign,
        "per_user": per_user,
        "per_user_day": per_user_day,
        "per_team": per_team,
        "user_team": user_team,
        "rate": rate,
    }


def _add_cell(mapping, key, points):
    cell = mapping.get(key)
    if cell is None:
        cell = mapping.get(str(key))
    if cell is None:
        cell = {"total": 0}
    cell["total"] = float(cell.get("total") or 0) + float(points)
    mapping[key] = cell


def apply_sambuca_timeseries(board, timeseries_user, timeseries_all, timeseries_team):
    if not board:
        return
    for uid, days in board["per_user_day"].items():
        bucket = timeseries_user.setdefault(uid, {})
        for days_ago, pts in days.items():
            _add_cell(bucket, days_ago, pts)
            _add_cell(timeseries_all, days_ago, pts)
            tid = board["user_team"].get(uid)
            if tid:
                _add_cell(timeseries_team.setdefault(tid, {}), days_ago, pts)


def _stamp_breakdown(value, piste, sambuca):
    piste = round(float(piste), 2)
    sambuca = round(float(sambuca), 2)
    value["piste_points"] = piste
    value["sambuca_points"] = sambuca
    value["points_breakdown"] = [
        {"label": "Piste", "kind": "piste", "points": piste},
        {"label": "Sambuca", "kind": "sambuca", "points": sambuca},
    ]


def apply_sambuca_leaderboard(board, rows, user_dict, id_field="workout__user__id"):
    if not board:
        return rows
    for value in user_dict.values():
        _stamp_breakdown(value, 0, 0)
    seen = set()
    for row in rows:
        uid = row[id_field]
        seen.add(uid)
        piste = float(row.get("total_capped") or 0)
        sambuca = float(board["per_user"].get(uid, 0))
        row["piste_points"] = round(piste, 2)
        row["sambuca_points"] = round(sambuca, 2)
        row["total_capped"] = piste + sambuca
        if uid in user_dict:
            _stamp_breakdown(user_dict[uid], piste, sambuca)
    for uid, pts in board["per_user"].items():
        if uid in seen or uid not in user_dict:
            continue
        sambuca = float(pts)
        if sambuca == 0:
            continue
        rows.append({
            id_field: uid,
            "total_capped": sambuca,
            "piste_points": 0.0,
            "sambuca_points": round(sambuca, 2),
        })
        _stamp_breakdown(user_dict[uid], 0, sambuca)
    return rows


def apply_sambuca_team_rows(board, rows, team_dict):
    if not board:
        return None
    present = set()
    adjusted = []
    for row in rows:
        tid = row["workout__user__my_teams__id"]
        if tid not in team_dict:
            continue
        present.add(tid)
        raw = float(row["total_capped"] or 0) + float(board["per_team"].get(tid, 0))
        active = max(1, team_dict[tid]["active_member_count"])
        adjusted.append({**row, "total_capped": raw / active})
    for tid, bonus in board["per_team"].items():
        if tid in present or tid not in team_dict or float(bonus) == 0:
            continue
        active = max(1, team_dict[tid]["active_member_count"])
        adjusted.append({
            "workout__user__my_teams__id": tid,
            "total_capped": float(bonus) / active,
        })
    return adjusted


def apply_sambuca_rank_rows(competition_id, totals):
    """Fold Sambuca into the rank-summary totals. Returns the board or None."""
    board = sambuca_points_by_user(competition_id)
    if not board:
        return None
    seen = set()
    for row in totals:
        uid = row["workout__user"]
        seen.add(uid)
        piste = float(row["total"] or 0)
        sambuca = float(board["per_user"].get(uid, 0))
        row["piste"] = round(piste, 2)
        row["sambuca"] = round(sambuca, 2)
        row["total"] = piste + sambuca
    missing = [uid for uid, pts in board["per_user"].items() if uid not in seen and float(pts) > 0]
    if missing:
        CustomUser = apps.get_model("custom_user", "CustomUser")
        for user in CustomUser.objects.filter(pk__in=missing, my_competitions__id=competition_id):
            sambuca = float(board["per_user"][user.id])
            totals.append({
                "workout__user": user.id,
                "workout__user__username": user.username,
                "total": sambuca,
                "piste": 0.0,
                "sambuca": round(sambuca, 2),
            })
    totals.sort(key=lambda row: (-float(row["total"] or 0), row["workout__user"] or 0))
    return board


def _weather_label(code):
    if code is None:
        return ""
    try:
        code = int(code)
    except (TypeError, ValueError):
        return ""
    if code == 0:
        return "Clear"
    if code in (1, 2, 3):
        return "Clouds"
    if code in (45, 48):
        return "Fog"
    if code in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82):
        return "Rain"
    if code in (71, 73, 75, 77, 85, 86):
        return "Snow"
    if code in (95, 96, 99):
        return "Storm"
    return "Mixed"


def _cm(meters):
    if meters is None:
        return None
    try:
        return round(float(meters) * 100)
    except (TypeError, ValueError):
        return None


def _num(value, digits=1):
    if value is None:
        return None
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


_SNOW_CODES = {71, 73, 75, 77, 85, 86}


def _recent_snowfall_cm(hourly, tz_name, now, hours):
    """Sum hourly snowfall (cm) over the trailing window. None if the feed has no hours."""
    times = (hourly or {}).get("time") or []
    values = (hourly or {}).get("snowfall") or []
    if not times or not values:
        return None
    now_local = as_aware(now).astimezone(zone(tz_name)).replace(tzinfo=None)
    cutoff = now_local - datetime.timedelta(hours=hours)
    total = 0.0
    seen = False
    for stamp, value in zip(times, values):
        try:
            moment = datetime.datetime.fromisoformat(str(stamp))
        except ValueError:
            continue
        if moment.tzinfo is not None:
            moment = moment.astimezone(zone(tz_name)).replace(tzinfo=None)
        if cutoff < moment <= now_local:
            seen = True
            if value is not None:
                total += float(value)
    if not seen:
        return None
    return round(total, 1)


def _forecast_call(lat, lon, tz_name, elevation, getter):
    params = {
        "latitude": lat,
        "longitude": lon,
        "timezone": tz_name or "Europe/Zurich",
        "forecast_days": 7,
        "past_days": 3,
        "current": "temperature_2m,weather_code,snowfall,snow_depth,freezing_level_height",
        "hourly": "snowfall,snow_depth,weather_code,freezing_level_height",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,snowfall_sum",
    }
    if elevation:
        params["elevation"] = int(elevation)
    response = getter(
        "https://api.open-meteo.com/v1/forecast",
        params=params,
        timeout=6,
        headers={"User-Agent": "WorkoutChallenge/skiweek"},
    )
    response.raise_for_status()
    return response.json()


def _shape_weather(valley, summit, *, tz_name="Europe/Zurich", now=None):
    current = (valley or {}).get("current") or {}
    summit_current = (summit or valley or {}).get("current") or {}
    daily = (valley or {}).get("daily") or {}
    now = as_aware(now)
    snow_24 = _recent_snowfall_cm((valley or {}).get("hourly"), tz_name, now, 24)
    snow_72 = _recent_snowfall_cm((valley or {}).get("hourly"), tz_name, now, 72)
    days = []
    times = daily.get("time") or []
    for index, date in enumerate(times[:7]):
        code = (daily.get("weather_code") or [None])[index] if index < len(daily.get("weather_code") or []) else None
        snowfall = (daily.get("snowfall_sum") or [None])[index] if index < len(daily.get("snowfall_sum") or []) else None
        tmax = (daily.get("temperature_2m_max") or [None])[index] if index < len(daily.get("temperature_2m_max") or []) else None
        tmin = (daily.get("temperature_2m_min") or [None])[index] if index < len(daily.get("temperature_2m_min") or []) else None
        days.append({
            "date": date,
            "weather_code": code,
            "label": _weather_label(code),
            "temp_max_c": _num(tmax),
            "temp_min_c": _num(tmin),
            "snowfall_cm": _num(snowfall, 1),
        })
    code = current.get("weather_code")
    try:
        code_int = int(code) if code is not None else None
    except (TypeError, ValueError):
        code_int = None
    snowfall_now = _num(current.get("snowfall"), 1) or 0
    is_snowing = code_int in _SNOW_CODES or snowfall_now > 0
    fresh = snow_24 if snow_24 is not None else None
    if is_snowing:
        mood = "snowing"
    elif fresh is not None and fresh >= 1:
        mood = "fresh"
    else:
        mood = "clear"
    return {
        "available": True,
        "attribution": WEATHER_ATTRIBUTION,
        "source": "Open-Meteo",
        "mood": mood,
        "is_snowing": is_snowing,
        "fresh_snow_cm": fresh,
        "snowfall_24h_cm": snow_24,
        "snowfall_72h_cm": snow_72,
        "current": {
            "temperature_c": _num(current.get("temperature_2m")),
            "summit_temperature_c": _num(summit_current.get("temperature_2m")),
            "weather_code": code,
            "label": _weather_label(code),
            "snowfall_cm": _num(current.get("snowfall"), 1),
            "freezing_level_m": _num(current.get("freezing_level_height"), 0),
            "snow_valley_cm": _cm(current.get("snow_depth")),
            "snow_summit_cm": _cm(summit_current.get("snow_depth")),
        },
        "daily": days,
    }


def fetch_weather(lat, lon, tz_name, summit_m, valley_m, *, getter=None, now=None):
    """Current conditions, a short forecast, and Berg/Tal snow. Cached 45 minutes."""
    if lat is None or lon is None:
        return {"available": False, "attribution": WEATHER_ATTRIBUTION, "source": "Open-Meteo"}
    key = f"skiweek-wx2:{round(float(lat), 3)}:{round(float(lon), 3)}:{valley_m or 0}:{summit_m or 0}"
    cached = cache.get(key)
    if cached:
        return cached
    getter = getter or requests.get
    try:
        valley = _forecast_call(lat, lon, tz_name, valley_m, getter)
        if summit_m and valley_m and int(summit_m) != int(valley_m):
            summit = _forecast_call(lat, lon, tz_name, summit_m, getter)
        else:
            summit = valley
        payload = _shape_weather(valley, summit, tz_name=tz_name or "Europe/Zurich", now=now)
    except Exception as exc:
        logger.info("Ski week weather unavailable: %s", exc)
        return {"available": False, "attribution": WEATHER_ATTRIBUTION, "source": "Open-Meteo"}
    cache.set(key, payload, WEATHER_TTL)
    return payload


def weather_for_campaign(campaign, *, getter=None):
    locked = campaign.weather_snapshot or {}
    if locked.get("lock") and (locked.get("current") or locked.get("daily")):
        payload = dict(locked)
        payload["available"] = True
        payload["attribution"] = WEATHER_ATTRIBUTION
        payload["source"] = locked.get("source") or "Open-Meteo"
        payload["snapshot"] = True
        payload.setdefault("mood", "clear")
        payload.setdefault("is_snowing", False)
        return _attach_opening(payload, campaign)
    live = fetch_weather(
        campaign.latitude, campaign.longitude, campaign.timezone,
        campaign.summit_elevation_m, campaign.valley_elevation_m, getter=getter,
    )
    if live.get("available"):
        return _attach_opening(live, campaign)
    snap = campaign.weather_snapshot or {}
    if snap.get("current") or snap.get("daily"):
        fallback = dict(snap)
        fallback["available"] = True
        fallback["attribution"] = WEATHER_ATTRIBUTION
        fallback["source"] = snap.get("source") or "Open-Meteo"
        fallback.setdefault("mood", "clear")
        fallback.setdefault("is_snowing", False)
        fallback["snapshot"] = True
        return _attach_opening(fallback, campaign)
    return _attach_opening(live, campaign)


def _attach_opening(weather, campaign):
    """Forecast rows that fall on the first ski days, when they are in range."""
    payload = dict(weather or {})
    start = campaign.competition.start_date
    end = campaign.competition.end_date
    opening = []
    if payload.get("available"):
        for row in payload.get("daily") or []:
            try:
                day = datetime.date.fromisoformat(str(row.get("date"))[:10])
            except (TypeError, ValueError):
                continue
            if start <= day <= end:
                opening.append(row)
            if len(opening) >= 4:
                break
    payload["opening_days"] = opening
    payload["opening_forecast_ready"] = bool(opening)
    return payload


def challenge_bounds(campaign):
    """Start and end instants in the resort timezone. End is exclusive (day after)."""
    tz = zone(campaign.timezone)
    start = datetime.datetime.combine(campaign.competition.start_date, datetime.time.min, tzinfo=tz)
    end = datetime.datetime.combine(
        campaign.competition.end_date + datetime.timedelta(days=1), datetime.time.min, tzinfo=tz,
    )
    return start, end


def phase_of(campaign, now=None):
    """prestart until local midnight of start_date, then live, then ended."""
    now_local = as_aware(now).astimezone(zone(campaign.timezone))
    start, end = challenge_bounds(campaign)
    if now_local >= end:
        return "ended"
    if now_local < start:
        return "prestart"
    return "live"


def milestone_for(campaign, now=None):
    """The one countdown beat due now, or None between beats.

    14, 7 and 3 are calendar days out. The day before is "1 day" until
    the last 12 hours, which is the final evening. Kickoff is the first
    six hours after the start instant. Missed beats are not replayed.
    """
    now_local = as_aware(now).astimezone(zone(campaign.timezone))
    start, _end = challenge_bounds(campaign)
    hours_left = (start - now_local).total_seconds() / 3600
    if hours_left <= 0:
        return "kickoff" if hours_left > -6 else None
    days_left = (start.date() - now_local.date()).days
    if days_left >= 1 and hours_left <= 12:
        return "final"
    if days_left == 14:
        return "d14"
    if days_left == 7:
        return "d7"
    if days_left == 3:
        return "d3"
    if days_left == 1 and hours_left > 12:
        return "d1"
    return None


def _user_public(uid, names):
    return {"user_id": uid, "username": names.get(uid) or "Athlete"}


def piste_totals(campaign, day):
    Workout = apps.get_model("workouts", "Workout")
    start, end = resort_day_window(campaign.timezone, campaign.day_cutoff_hour, day)
    member_ids = list(campaign.competition.user.values_list("id", flat=True))
    rows = Workout.objects.filter(
        user_id__in=member_ids,
        sport_type__in=SKI_SPORTS,
        start_datetime__gte=start,
        start_datetime__lt=end,
    )
    by_user = {}
    elevation = 0.0
    runs = 0
    distance = 0.0
    for workout in rows.only("user_id", "elevation_m", "runs", "distance"):
        bucket = by_user.setdefault(workout.user_id, {"elevation_m": 0.0, "runs": 0, "distance_km": 0.0})
        if workout.elevation_m is not None:
            bucket["elevation_m"] += float(workout.elevation_m)
            elevation += float(workout.elevation_m)
        if workout.runs is not None:
            bucket["runs"] += int(workout.runs)
            runs += int(workout.runs)
        if workout.distance is not None:
            bucket["distance_km"] += float(workout.distance)
            distance += float(workout.distance)
    return {
        "elevation_m": round(elevation, 1),
        "runs": runs,
        "distance_km": round(distance, 2),
        "by_user": by_user,
    }


def workout_points_between(competition_id, start, end):
    Points = apps.get_model("competition", "Points")
    from django.db.models import Q
    rows = (
        Points.objects.filter(
            Q(award__competition_id=competition_id) | Q(goal__competition_id=competition_id),
            workout__start_datetime__gte=start,
            workout__start_datetime__lt=end,
        )
        .values("workout__user_id")
        .annotate(total=Sum("points_capped"))
    )
    return {row["workout__user_id"]: float(row["total"] or 0) for row in rows}


def _board_rows(campaign, day, names, rate):
    start, end = resort_day_window(campaign.timezone, campaign.day_cutoff_hour, day)
    piste = piste_totals(campaign, day)
    points = workout_points_between(campaign.competition_id, start, end)
    sambuca = dict(daily_amounts(campaign, day, KIND_SAMBUCA))
    water = dict(daily_amounts(campaign, day, KIND_WATER))
    ids = set(names) | set(piste["by_user"]) | set(points) | set(sambuca) | set(water)
    rows = []
    for uid in ids:
        piste_row = piste["by_user"].get(uid) or {}
        sambuca_n = int(sambuca.get(uid, 0))
        sambuca_pts = float((Decimal(sambuca_n) * rate).quantize(Decimal("0.01")))
        piste_pts = round(points.get(uid, 0.0), 2)
        rows.append({
            **_user_public(uid, names),
            "punkte": round(piste_pts + sambuca_pts, 2),
            "piste_points": piste_pts,
            "sambuca": sambuca_n,
            "sambuca_points": sambuca_pts,
            "elevation_m": round(piste_row.get("elevation_m") or 0, 1),
            "runs": int(piste_row.get("runs") or 0),
            "distance_km": round(piste_row.get("distance_km") or 0, 2),
            "water": int(water.get(uid, 0)),
        })
    rows.sort(key=lambda row: (-row["sambuca"], -row["punkte"], row["username"] or ""))
    return rows


def week_bounds(campaign, today):
    start = campaign.competition.start_date
    end = min(campaign.competition.end_date, today)
    if end < start:
        end = start
    return start, end


def build_payload(campaign, user, *, now=None, getter=None):
    from .models import SambucaCrown, SambucaEntry, SambucaSettlement

    now = as_aware(now)
    day = resort_day(now, campaign.timezone, campaign.day_cutoff_hour)
    names = {u.id: u.username for u in _participants(campaign.competition)}
    rate = campaign.points_per_sambuca or Decimal("0")
    live_rows = daily_amounts(campaign, day, KIND_SAMBUCA)
    live_winners, live_count = leaders_for(live_rows)
    settled_today = SambucaSettlement.objects.filter(campaign=campaign, resort_day=day).exists()

    latest = (
        SambucaSettlement.objects.filter(campaign=campaign, winning_count__gt=0, resort_day__lt=day)
        .order_by("-resort_day")
        .first()
    )
    wearing = []
    yesterday = None
    if latest is not None:
        crown_users = list(
            SambucaCrown.objects.filter(settlement=latest).values_list("user_id", flat=True)
        )
        wearing = [
            {**_user_public(uid, names), "count": latest.winning_count, "resort_day": latest.resort_day.isoformat()}
            for uid in crown_users
        ]
        if latest.resort_day == day - datetime.timedelta(days=1):
            yesterday = {
                "resort_day": latest.resort_day.isoformat(),
                "count": latest.winning_count,
                "users": wearing,
                "tied": len(wearing) > 1,
            }

    mine = [
        {
            "id": entry.id,
            "amount": entry.amount,
            "kind": entry.kind,
            "logged_at": entry.logged_at.isoformat(),
            "resort_day": entry.resort_day.isoformat(),
            "has_photo": bool(entry.photo),
            "photo_url": (
                f"/api/competition/{campaign.competition_id}/skiweek/sips/{entry.id}/photo/"
                if entry.photo else None
            ),
        }
        for entry in SambucaEntry.objects.filter(campaign=campaign, user=user, resort_day=day)
    ]
    week_start, week_end = week_bounds(campaign, day)
    week_rows = {}
    cursor = week_start
    while cursor <= week_end:
        for row in _board_rows(campaign, cursor, names, rate):
            bucket = week_rows.setdefault(row["user_id"], {
                **_user_public(row["user_id"], names),
                "punkte": 0.0,
                "piste_points": 0.0,
                "sambuca": 0,
                "sambuca_points": 0.0,
                "elevation_m": 0.0,
                "runs": 0,
                "distance_km": 0.0,
                "water": 0,
                "crowns": 0,
            })
            for key in ("punkte", "piste_points", "sambuca_points", "elevation_m", "distance_km"):
                bucket[key] = round(bucket[key] + row[key], 2)
            bucket["sambuca"] += row["sambuca"]
            bucket["runs"] += row["runs"]
            bucket["water"] += row["water"]
        cursor += datetime.timedelta(days=1)
    from django.db.models import Count
    crown_counts = {
        row["user_id"]: row["n"]
        for row in SambucaCrown.objects.filter(settlement__campaign=campaign).values("user_id").annotate(n=Count("id"))
    }
    for uid, bucket in week_rows.items():
        bucket["crowns"] = int(crown_counts.get(uid, 0))
    week = sorted(week_rows.values(), key=lambda row: (-row["sambuca"], -row["punkte"], row["username"] or ""))

    my_rate_total = sambuca_points_by_user(campaign.competition_id)
    my_sambuca = float((my_rate_total or {}).get("per_user", {}).get(user.id, 0))
    from django.db.models import Q
    Points = apps.get_model("competition", "Points")
    piste_pts = Points.objects.filter(
        Q(award__competition_id=campaign.competition_id) | Q(goal__competition_id=campaign.competition_id),
        workout__user=user,
    ).aggregate(total=Sum("points_capped"))["total"]
    piste_pts = float(piste_pts or 0)
    weather = weather_for_campaign(campaign, getter=getter)
    coach = _active_coach(campaign)
    language = (coach.persona.language if coach is not None and coach.persona_id else None) or "en"
    return {
        "enabled": True,
        "phase": phase_of(campaign, now),
        "language": language,
        "starts_at": challenge_bounds(campaign)[0].isoformat(),
        "coach_teaser": coach_teaser_payload(campaign, now=now, weather=weather),
        "resort": {
            "slug": campaign.resort_slug,
            "name": campaign.resort_name,
            "latitude": float(campaign.latitude) if campaign.latitude is not None else None,
            "longitude": float(campaign.longitude) if campaign.longitude is not None else None,
            "summit_elevation_m": campaign.summit_elevation_m,
            "valley_elevation_m": campaign.valley_elevation_m,
        },
        "timezone": campaign.timezone,
        "day_cutoff_hour": campaign.day_cutoff_hour,
        "water_enabled": campaign.water_enabled,
        "points_per_sambuca": float(rate),
        "resort_day": day.isoformat(),
        "next_cutoff": next_cutoff(now, campaign.timezone, campaign.day_cutoff_hour).isoformat(),
        "soft_confirm_at": SOFT_CONFIRM_AT,
        "today": {
            "logs": mine,
            "sambuca_mine": sum(item["amount"] for item in mine if item["kind"] == KIND_SAMBUCA),
            "water_mine": sum(item["amount"] for item in mine if item["kind"] == KIND_WATER),
            "piste": piste_totals(campaign, day),
        },
        "live": {
            "resort_day": day.isoformat(),
            "settled": settled_today,
            "count": live_count,
            "tied": len(live_winners) > 1,
            "leaders": [
                {**_user_public(uid, names), "count": total}
                for uid, total in live_winners
            ],
        },
        "wearing": wearing,
        "yesterday": yesterday,
        "board": {
            "day": _board_rows(campaign, day, names, rate),
            "week": week,
        },
        "scoring": {
            "piste": round(piste_pts, 2),
            "sambuca": round(my_sambuca, 2),
            "total": round(piste_pts + my_sambuca, 2),
            "points_per_sambuca": float(rate),
            "breakdown": [
                {"label": "Piste", "kind": "piste", "points": round(piste_pts, 2)},
                {"label": "Sambuca", "kind": "sambuca", "points": round(my_sambuca, 2)},
            ],
        },
        "weather": weather,
        "awards": award_payload(campaign, now=now),
        "cards": _cards(campaign, user),
    }


AWARD_ORDER = (
    "sambuca_royalty",
    "erste_liftfahrt",
    "meiste_hoehenmeter",
    "laengster_skitag",
    "fruehstarter",
    "most_improved",
    "water_streak",
)


def _tied(scores):
    """Users who share the highest positive score."""
    positive = {uid: value for uid, value in scores.items() if value and value > 0}
    if not positive:
        return []
    top = max(positive.values())
    return [(uid, top) for uid, value in positive.items() if value == top]


def compute_week_awards(campaign):
    """Freeze end-of-week awards. Safe to call again; rows are replaced."""
    from .models import SambucaEntry, SkiWeekAward
    Workout = apps.get_model("workouts", "Workout")
    start, end = challenge_bounds(campaign)
    members = list(campaign.competition.user.all())
    names = {user.id: user.username for user in members}
    member_ids = list(names)
    SkiWeekAward.objects.filter(campaign=campaign).delete()
    created = []

    def grant(kind, scores, detail_for):
        for uid, value in _tied(scores):
            row = SkiWeekAward.objects.create(
                campaign=campaign, kind=kind, user_id=uid,
                value=Decimal(str(value)), detail=detail_for(uid, value)[:80],
            )
            created.append(row)

    sambuca = {
        row["user_id"]: int(row["total"] or 0)
        for row in SambucaEntry.objects.filter(campaign=campaign, kind=KIND_SAMBUCA)
        .values("user_id").annotate(total=Sum("amount"))
    }
    grant("sambuca_royalty", sambuca, lambda _uid, value: f"{int(value)}")

    workouts = list(Workout.objects.filter(
        user_id__in=member_ids,
        sport_type__in=SKI_SPORTS,
        start_datetime__gte=start,
        start_datetime__lt=end,
    ))
    if workouts:
        earliest_start = min(workout.start_datetime for workout in workouts)
        first_lift = as_aware(earliest_start).astimezone(zone(campaign.timezone)).strftime("%d.%m. %H:%M")
        grant(
            "erste_liftfahrt",
            {workout.user_id: 1 for workout in workouts if workout.start_datetime == earliest_start},
            lambda _uid, _value: first_lift,
        )
        elevation = {}
        for workout in workouts:
            elevation[workout.user_id] = elevation.get(workout.user_id, 0) + float(workout.elevation_m or 0)
        grant("meiste_hoehenmeter", elevation, lambda _uid, value: f"{int(value)} m")
        by_day = {}
        earliest = {}
        for workout in workouts:
            local = as_aware(workout.start_datetime).astimezone(zone(campaign.timezone))
            key = (workout.user_id, local.date())
            by_day[key] = by_day.get(key, 0) + workout.duration.total_seconds()
            clock = local.hour * 60 + local.minute
            if workout.user_id not in earliest or clock < earliest[workout.user_id]:
                earliest[workout.user_id] = clock
        longest = {}
        for (uid, _day), seconds in by_day.items():
            longest[uid] = max(longest.get(uid, 0), seconds / 60)
        grant("laengster_skitag", longest, lambda _uid, value: f"{int(value)} min")
        grant("fruehstarter", {uid: 24 * 60 - minutes for uid, minutes in earliest.items()}, lambda uid, _value: f"{earliest[uid] // 60:02d}:{earliest[uid] % 60:02d}")
        midpoint = start + (end - start) / 2
        first_half, second_half = {}, {}
        for workout in workouts:
            bucket = first_half if as_aware(workout.start_datetime) < midpoint else second_half
            bucket[workout.user_id] = bucket.get(workout.user_id, 0) + float(workout.elevation_m or 0)
        improved = {
            uid: second_half.get(uid, 0) - first_half.get(uid, 0)
            for uid in set(first_half) | set(second_half)
        }
        grant("most_improved", improved, lambda _uid, value: f"+{int(value)} m")

    if campaign.water_enabled:
        water_days = {}
        for row in SambucaEntry.objects.filter(campaign=campaign, kind=KIND_WATER).values("user_id", "resort_day"):
            water_days.setdefault(row["user_id"], set()).add(row["resort_day"])
        streaks = {}
        for uid, days in water_days.items():
            ordered = sorted(days)
            best = run = 1
            for previous, current in zip(ordered, ordered[1:]):
                run = run + 1 if current == previous + datetime.timedelta(days=1) else 1
                best = max(best, run)
            streaks[uid] = best
        grant("water_streak", streaks, lambda _uid, value: f"{int(value)} days")
    return created


def _cards(campaign, user):
    from .ski_photos import cards_payload
    return cards_payload(campaign, user)


def award_payload(campaign, now=None):
    from .models import SkiWeekAward
    if phase_of(campaign, now) != "ended":
        return []
    if not SkiWeekAward.objects.filter(campaign=campaign).exists():
        compute_week_awards(campaign)
    names = {user.id: user.username for user in campaign.competition.user.all()}
    rows = []
    for award in SkiWeekAward.objects.filter(campaign=campaign).select_related("user"):
        rows.append({
            "kind": award.kind,
            "user_id": award.user_id,
            "username": names.get(award.user_id) or award.user.username,
            "value": float(award.value),
            "detail": award.detail,
        })
    rows.sort(key=lambda row: (AWARD_ORDER.index(row["kind"]) if row["kind"] in AWARD_ORDER else 99, row["username"] or ""))
    return rows


_DRINK_NUDGE = (
    "drink more", "another round", "sambuca", "one more shot", "get drunk",
    "bottoms up", "have a drink", "hit the bar",
)

_MILESTONE_LABEL = {
    "d14": "14 days until the ski week starts",
    "d7": "7 days until the ski week starts",
    "d3": "3 days until the ski week starts",
    "d1": "1 day until the ski week starts",
    "final": "the final hours before the ski week starts",
    "kickoff": "the ski week just started",
}


def _fmt_cm(value):
    if value is None:
        return None
    number = float(value)
    if number == int(number):
        return str(int(number))
    return f"{number:.1f}"


def snow_hook(weather):
    """At most two snow facts, as a short clause. Never a full report."""
    if not weather or not weather.get("available"):
        return ""
    current = weather.get("current") or {}
    fresh = weather.get("fresh_snow_cm")
    if fresh is None:
        fresh = weather.get("snowfall_24h_cm")
    facts = []
    if fresh is not None and float(fresh) >= 1:
        facts.append(f"{_fmt_cm(fresh)} cm of fresh snow")
    summit = current.get("snow_summit_cm")
    valley = current.get("snow_valley_cm")
    if summit is not None:
        facts.append(f"{_fmt_cm(summit)} cm on the summit")
    elif valley is not None:
        facts.append(f"{_fmt_cm(valley)} cm in the valley")
    return " and ".join(facts[:2])


def snow_sentence(weather):
    """Short snow clause. Callers that want a sentence get at most two facts."""
    hook = snow_hook(weather)
    if not hook:
        return "The snow report is still settling."
    sentence = hook[0].upper() + hook[1:]
    return sentence if sentence.endswith(".") else sentence + "."


def _days_until(campaign, now):
    """Whole days left, the same number the countdown clock shows."""
    now_local = as_aware(now).astimezone(zone(campaign.timezone))
    start, _end = challenge_bounds(campaign)
    remaining = (start - now_local).total_seconds()
    if remaining <= 0:
        return 0
    return int(remaining // 86400)


def fallback_teaser(milestone, resort, weather, *, days=None, language="en"):
    resort_name = resort or "the resort"
    hook = snow_hook(weather)
    lang = "de" if str(language or "en").lower().startswith("de") else "en"
    day_count = 1 if days is None else int(days)
    if lang == "de":
        leads = {
            "d14": f"Noch vierzehn Tage bis {resort_name}.",
            "d7": f"Noch eine Woche bis {resort_name}.",
            "d3": f"Noch drei Tage bis {resort_name}.",
            "d1": f"Noch ein Tag bis {resort_name}.",
            "final": f"Die letzten Stunden vor {resort_name}.",
            "kickoff": f"{resort_name} ist offen.",
            "preview": (
                f"Noch ein Tag bis {resort_name}." if day_count == 1
                else f"Noch {day_count} Tage bis {resort_name}."
            ),
        }
        if hook:
            hook = (
                hook.replace(" cm of fresh snow", " cm Neuschnee")
                .replace(" cm on the summit", " cm am Gipfel")
                .replace(" cm in the valley", " cm im Tal")
                .replace(" and ", " und ")
            )
    else:
        leads = {
            "d14": f"Fourteen days until {resort_name}.",
            "d7": f"One week until {resort_name}.",
            "d3": f"Three days to {resort_name}.",
            "d1": f"One day to {resort_name}.",
            "final": f"Final hours before {resort_name}.",
            "kickoff": f"{resort_name} is open.",
            "preview": (
                f"One day to {resort_name}." if day_count == 1
                else f"{day_count} days to {resort_name}."
            ),
        }
    tail = f" {hook}." if hook else ""
    return (leads.get(milestone) or leads["preview"]) + tail


def _line_is_safe(text):
    lowered = (text or "").lower()
    return bool(text and text.strip()) and not any(phrase in lowered for phrase in _DRINK_NUDGE)


def _persona_public(config):
    if config is None or config.persona_id is None:
        return None
    persona = config.persona
    return {
        "name": persona.name,
        "tagline": persona.tagline or "",
        "avatar": persona.avatar or "",
        "theme_color": persona.theme_color or "",
        "language": persona.language or "en",
    }


def _active_coach(campaign):
    from drill_instructor.models import DrillInstructorConfig
    return (
        DrillInstructorConfig.objects.filter(competition_id=campaign.competition_id, enabled=True)
        .select_related("persona")
        .first()
    )


def compose_teaser(campaign, milestone, weather, *, generator=None):
    """Persona line for one milestone. Falls back when the model is down or unsafe."""
    resort = campaign.resort_name or "the resort"
    language = "en"
    if _active_coach(campaign) and _active_coach(campaign).persona_id:
        language = _active_coach(campaign).persona.language or "en"
    fallback = fallback_teaser(milestone, resort, weather, language=language)
    config = _active_coach(campaign)
    if config is None or not (config.persona and config.persona.system_prompt):
        return fallback, "fallback", config
    if generator is None:
        from drill_instructor.llm_client import generate_message
        generator = generate_message
    prompt = (
        f"Write one countdown line for the ski week at {resort}.\n"
        f"Moment: {_MILESTONE_LABEL.get(milestone, milestone)}.\n"
        f"Snow to mention, at most these two facts: {snow_hook(weather) or 'none yet'}.\n"
        "Stay in your persona's voice. One or two short sentences. Name the resort. "
        "Use at most two snow facts. Do not list every number. "
        "The time left in the moment line is exact. Do not invent a different number of days. "
        "Do not tell anyone to drink, and do not mention alcohol."
    )
    try:
        text, _error = generator(
            system_prompt=config.persona.system_prompt,
            user_prompt=prompt,
            language=config.persona.language,
            require_athlete_name=False,
            max_tokens=120,
        )
    except Exception:
        logger.info("Ski week teaser model failed", exc_info=True)
        text = None
    if not _line_is_safe(text) or str(text).lower().count(" cm") > 2:
        return fallback, "fallback", config
    return " ".join(str(text).split())[:400], "llm", config


def _line_matches_clock(body, milestone):
    """A stored line that names the wrong day count is worse than silence."""
    if not body or (body.lower().count(" cm") > 2):
        return False
    lowered = body.lower()
    if milestone == "d1" and ("three day" in lowered or "3 day" in lowered or "drei tag" in lowered):
        return False
    if milestone == "d3" and ("one day" in lowered or "1 day" in lowered or "ein tag" in lowered):
        return False
    if milestone == "preview" and ("three day" in lowered or "fourteen" in lowered):
        return False
    return True


def coach_teaser_payload(campaign, *, now=None, weather=None):
    """A line for the time that is left now, not a stale milestone."""
    from .models import SkiWeekTeaser
    config = _active_coach(campaign)
    persona = _persona_public(config)
    language = (persona or {}).get("language") or "en"
    phase = phase_of(campaign, now)
    if phase == "ended":
        return None
    if weather is None:
        weather = weather_for_campaign(campaign)
    days = _days_until(campaign, now)
    current = milestone_for(campaign, now)
    if current is None:
        if phase == "live":
            current = "kickoff"
        elif days <= 0:
            current = "final"
        elif days == 1:
            current = "d1"
        else:
            current = "preview"
    latest = (
        SkiWeekTeaser.objects.filter(campaign=campaign, milestone=current)
        .order_by("-posted_at", "-id")
        .first()
    )
    if latest is not None and _line_matches_clock(latest.body, current):
        body, source, posted = latest.body, latest.source, True
    else:
        body = fallback_teaser(current, campaign.resort_name, weather, days=days, language=language)
        source, posted = "fallback", False
    return {
        "milestone": current,
        "days_left": days,
        "body": body,
        "source": source,
        "posted": posted,
        "persona": persona,
        "language": language,
    }


def post_teaser_if_due(campaign, *, now=None, generator=None, weather=None):
    """Post at most one new milestone line. Repeats are no-ops."""
    from django.db import IntegrityError, transaction
    from .models import SkiWeekTeaser

    milestone = milestone_for(campaign, now)
    if milestone is None or not campaign.enabled:
        return None
    if SkiWeekTeaser.objects.filter(campaign=campaign, milestone=milestone).exists():
        return None
    if weather is None:
        weather = weather_for_campaign(campaign)
    body, source, config = compose_teaser(campaign, milestone, weather, generator=generator)
    try:
        with transaction.atomic():
            teaser = SkiWeekTeaser.objects.create(
                campaign=campaign, milestone=milestone, body=body, source=source,
            )
    except IntegrityError:
        return None
    if config is not None:
        try:
            from drill_instructor.tasks import _post_coach_line
            from drill_instructor.models import DrillInstructorMessage
            message = _post_coach_line(
                config, DrillInstructorMessage.KIND_SKIWEEK, body, send_push=False,
            )
            teaser.message_id = message.pk
            teaser.save(update_fields=["message_id"])
        except Exception:
            logger.exception("Ski week teaser could not join the coach thread")
        if config.send_push_on_activity:
            _push_teaser(campaign, config, teaser)
    return teaser


def _push_teaser(campaign, config, teaser):
    """Lock-screen line in the Skiwoche category. Never a 'drink more' ping."""
    try:
        from push_notifications.sender import send_push_to_user
    except Exception:
        return
    persona = config.persona
    title = f"Skiwoche · {campaign.resort_name or campaign.competition.name}"
    if persona and persona.name:
        title = f"{persona.name} · {campaign.resort_name or 'Skiwoche'}"
    url = f"/competition/{campaign.competition_id}?tab=feed"
    for participant in campaign.competition.user.all():
        try:
            send_push_to_user(
                participant,
                title=title[:80],
                body=teaser.body[:180],
                url=url,
                tag=f"skiweek-{campaign.pk}-{teaser.milestone}",
                category="skiweek",
                cooldown_seconds=60 * 60 * 12,
                cooldown_key=f"skiweek-push:{participant.pk}:{teaser.milestone}",
            )
        except Exception:
            logger.info("Ski week push skipped for user %s", participant.pk, exc_info=True)


def post_due_teasers(now=None):
    from .models import SkiWeekCampaign
    posted = 0
    for campaign in SkiWeekCampaign.objects.filter(enabled=True).select_related("competition"):
        if post_teaser_if_due(campaign, now=now) is not None:
            posted += 1
    return {"posted": posted}

"""Load an athlete's stored days, score today, and keep their private order in step."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.utils import timezone

from .models import (
    AthleteOrder,
    ChallengeReadinessSetting,
    MorningCheckIn,
    ReadinessSnapshot,
    RecoveryDay,
    RecoveryPreference,
    athlete_today,
    athlete_zone,
)
from .orders import compose_voice, on_workout_logged, order_payload, prescribe
from .schedule import push_is_due
from .score import DISCLAIMER, score_day
from .sources import (
    ALL_SCOPES,
    CONSENT_TEXT,
    CONSENT_VERSION,
    GARMIN_SCOPES,
    HEALTH_SCOPES,
    SOURCE_NOTES,
)

logger = logging.getLogger(__name__)

# Re-export so game.py has one hook.
__all__ = ["on_workout_logged", "refresh_athlete", "today_payload", "sweep"]


def _preference(user) -> RecoveryPreference:
    pref, _created = RecoveryPreference.objects.get_or_create(user=user)
    return pref


def _rows(user, today):
    start = today - timedelta(days=35)
    return list(RecoveryDay.objects.filter(user=user, date__gte=start, date__lte=today))


def training_load(user, today, tz):
    """Daily load before ``today``. Points when the athlete has any in the
    window, otherwise minutes. The chart also receives minutes by day,
    including today, so the bars stay readable."""
    from competition.models import Points
    from workouts.models import Workout

    start_day = today - timedelta(days=35)
    workouts = (
        Workout.objects.filter(user=user, start_datetime__date__gte=start_day)
        .exclude(sport_type="Steps")
        .only("start_datetime", "duration")
    )
    minutes = {}
    for workout in workouts:
        start = workout.start_datetime
        if start is None:
            continue
        if timezone.is_naive(start):
            start = timezone.make_aware(start, timezone.get_current_timezone())
        day = start.astimezone(tz).date()
        if day > today or workout.duration is None:
            continue
        minutes[day] = minutes.get(day, 0) + workout.duration.total_seconds() / 60.0

    point_rows = (
        Points.objects.filter(workout__user=user, workout__start_datetime__date__gte=start_day)
        .select_related("workout")
        .only("points_capped", "workout__start_datetime")
    )
    points = {}
    for row in point_rows:
        start = row.workout.start_datetime
        if start is None:
            continue
        if timezone.is_naive(start):
            start = timezone.make_aware(start, timezone.get_current_timezone())
        day = start.astimezone(tz).date()
        if day > today:
            continue
        points[day] = points.get(day, 0) + float(row.points_capped or 0)

    if sum(points.values()) > 0:
        history = [(day, value) for day, value in points.items() if day < today]
        unit = "pts"
        by_day = points
    else:
        history = [(day, value) for day, value in minutes.items() if day < today]
        unit = "min"
        by_day = minutes
    return history, unit, by_day


def recompute(user, today=None) -> ReadinessSnapshot:
    tz = athlete_zone(user)
    today = today or athlete_today(user)
    rows = _rows(user, today)
    by_date = {row.date: row for row in rows}
    current = by_date.get(today)
    checkin = MorningCheckIn.objects.filter(user=user, date=today).first()
    history = [row for row in rows if row.date < today]
    load_history, _unit, _by_day = training_load(user, today, tz)
    metric = (current.hrv_metric if current and current.hrv_metric else "") or "rmssd"
    result = score_day(
        today=today,
        hrv=None if current is None else current.hrv_ms,
        hrv_metric=metric,
        hrv_history=[(row.date, row.hrv_ms, row.hrv_metric or "") for row in history if row.hrv_ms is not None],
        rhr=None if current is None else current.resting_hr,
        rhr_history=[(row.date, row.resting_hr) for row in history if row.resting_hr is not None],
        sleep_minutes=None if current is None else current.sleep_minutes,
        sleep_quality=None if current is None else current.sleep_quality,
        sleep_history=[(row.date, row.sleep_minutes) for row in history if row.sleep_minutes is not None],
        load_history=load_history,
        body_battery=None if current is None else current.body_battery,
        training_readiness=None if current is None else current.training_readiness,
        stress=None if current is None else current.stress_avg,
        feel=None if checkin is None else checkin.feel,
        soreness=None if checkin is None else checkin.soreness,
    )
    snapshot, _created = ReadinessSnapshot.objects.update_or_create(
        user=user,
        date=today,
        defaults={
            "score": result.score,
            "band": result.band,
            "why": result.why[:180],
            "components": result.components,
            "warming_up": result.warming_up,
        },
    )
    return snapshot


def ensure_orders(user, snapshot: ReadinessSnapshot, *, with_voice: bool = False):
    from drill_instructor.models import DrillInstructorConfig

    from .orders import _live_echo, _typical_minutes

    if snapshot.warming_up or not snapshot.band:
        return []
    configs = (
        DrillInstructorConfig.objects.filter(
            enabled=True,
            competition__user=user,
            competition__start_date__lte=snapshot.date,
            competition__end_date__gte=snapshot.date,
        )
        .select_related("persona", "competition")
    )
    saved = []
    typical = _typical_minutes(user, snapshot.date)
    for config in configs:
        echo = _live_echo(config, user) if snapshot.band == "green" else None
        plan = prescribe(snapshot.band, echo=echo, typical_minutes=typical)
        if plan is None:
            continue
        order, created = AthleteOrder.objects.get_or_create(
            user=user,
            config=config,
            date=snapshot.date,
            defaults={
                "kind": plan["kind"],
                "spec": plan["spec"],
                "brief": plan["brief"],
                "why": snapshot.why[:180],
                "band": snapshot.band,
                "score": snapshot.score,
            },
        )
        if not created and not order.completed and not order.notified:
            changed = (
                order.band != snapshot.band
                or order.kind != plan["kind"]
                or order.brief != plan["brief"]
            )
            if changed:
                order.kind = plan["kind"]
                order.spec = plan["spec"]
                order.brief = plan["brief"]
                order.band = snapshot.band
                order.score = snapshot.score
                order.why = snapshot.why[:180]
                order.voice = ""
                order.save()
        if with_voice and not order.voice and not order.completed and config.persona_id:
            order.voice = compose_voice(
                config.persona,
                band=order.band,
                brief=order.brief,
                why=order.why,
                athlete_name=user.first_name or user.username or "Athlete",
            )
            order.save(update_fields=["voice", "updated_at"])
        saved.append(order)
    return saved


def refresh_athlete(user, *, with_voice: bool = False, today=None):
    snapshot = recompute(user, today=today)
    orders = ensure_orders(user, snapshot, with_voice=with_voice)
    return snapshot, orders


def _trend(user, today, tz):
    history, unit, by_day = training_load(user, today, tz)
    del history
    rows = {row.date: row for row in RecoveryDay.objects.filter(user=user, date__gte=today - timedelta(days=6), date__lte=today)}
    trend = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        row = rows.get(day)
        load = by_day.get(day)
        trend.append({
            "date": day.isoformat(),
            "hrv_ms": None if row is None else row.hrv_ms,
            "hrv_metric": "" if row is None else row.hrv_metric,
            "resting_hr": None if row is None else row.resting_hr,
            "sleep_minutes": None if row is None else row.sleep_minutes,
            "load": None if load is None else round(load, 1),
            "load_unit": unit,
        })
    return trend


def available_scopes(user) -> list[dict]:
    linked = set(user.get_linked_sources())
    scopes = []
    labels = {
        "sleep": "Sleep duration and quality",
        "hrv": "Overnight HRV",
        "resting_hr": "Resting heart rate",
        "body_battery": "Garmin Body Battery",
        "training_readiness": "Garmin training readiness",
        "stress": "Garmin average stress",
    }
    offered = set()
    if "garmin" in linked:
        offered.update(GARMIN_SCOPES)
    if "health" in linked:
        offered.update(HEALTH_SCOPES)
    for scope in ALL_SCOPES:
        if scope not in offered:
            continue
        sources = []
        if scope in GARMIN_SCOPES and "garmin" in linked:
            sources.append("garmin")
        if scope in HEALTH_SCOPES and "health" in linked:
            sources.append("health")
        scopes.append({"id": scope, "label": labels[scope], "sources": sources})
    return scopes


def source_catalog(user) -> list[dict]:
    linked = set(user.get_linked_sources())
    catalog = []
    if "strava" in linked or not linked:
        catalog.append({"id": "strava", **SOURCE_NOTES["strava"]})
    if "garmin" in linked:
        catalog.append({"id": "garmin", **SOURCE_NOTES["garmin"]})
    if "health" in linked:
        catalog.append({"id": "health_connect", **SOURCE_NOTES["health_connect"]})
        catalog.append({"id": "apple_health", **SOURCE_NOTES["apple_health"]})
    if not catalog:
        catalog.append({"id": "strava", **SOURCE_NOTES["strava"]})
    return catalog


def morning_notice(user, orders):
    pref = RecoveryPreference.objects.filter(user=user).first()
    if pref is None or not pref.morning_push_enabled or pref.morning_push_minute is None:
        return None
    if not orders:
        return None
    now_local = timezone.now().astimezone(athlete_zone(user))
    if pref.notice_acked_on == now_local.date() or pref.push_sent_on == now_local.date():
        return None
    due = push_is_due(
        now_local,
        chosen_minute=pref.morning_push_minute,
        quiet_start=pref.quiet_start_minute,
        quiet_end=pref.quiet_end_minute,
        already_sent=False,
    )
    if not due:
        return None
    order = orders[0]
    persona = getattr(order.config, "persona", None)
    name = persona.name if persona is not None else "Coach"
    return {
        "id": f"readiness-{user.pk}-{now_local.date().isoformat()}",
        "title": f"{name}: Order of the Day",
        "body": ((order.voice or order.brief) or "")[:180],
        "url": "/",
    }


def today_payload(user, competition_id=None):
    snapshot, orders = refresh_athlete(user, with_voice=False)
    pref = _preference(user)
    checkin = MorningCheckIn.objects.filter(user=user, date=snapshot.date).first()
    payloads = [order_payload(order) for order in orders]
    primary = None
    if competition_id:
        primary = next((item for item in payloads if str(item["competition_id"]) == str(competition_id)), None)
    if primary is None and payloads:
        primary = payloads[0]
    tz = athlete_zone(user)
    return {
        "date": snapshot.date.isoformat(),
        "timezone": getattr(tz, "key", str(tz)),
        "disclaimer": DISCLAIMER,
        "consent": {
            "text": CONSENT_TEXT,
            "version": CONSENT_VERSION,
            "opted_in": pref.opted_in,
            "scopes": list(pref.scopes or []),
            "available_scopes": available_scopes(user),
            "sources": source_catalog(user),
        },
        "preference": {
            "morning_push_enabled": pref.morning_push_enabled,
            "morning_push_minute": pref.morning_push_minute,
            "quiet_start_minute": pref.quiet_start_minute,
            "quiet_end_minute": pref.quiet_end_minute,
        },
        "score": snapshot.score,
        "band": snapshot.band,
        "why": snapshot.why,
        "components": snapshot.components or {},
        "warming_up": snapshot.warming_up,
        "checkin": None if checkin is None else {"feel": checkin.feel, "soreness": checkin.soreness},
        "trend": _trend(user, snapshot.date, tz),
        "order": primary,
        "orders": payloads,
        "morning_notice": morning_notice(user, orders),
    }


def save_checkin(user, feel: int, soreness):
    today = athlete_today(user)
    MorningCheckIn.objects.update_or_create(
        user=user,
        date=today,
        defaults={"feel": feel, "soreness": soreness},
    )
    return refresh_athlete(user, with_voice=False)


def delete_recovery_data(user):
    RecoveryDay.objects.filter(user=user).delete()
    MorningCheckIn.objects.filter(user=user).delete()
    ReadinessSnapshot.objects.filter(user=user).delete()
    AthleteOrder.objects.filter(user=user).delete()
    pref = RecoveryPreference.objects.filter(user=user).first()
    if pref is not None:
        pref.opted_in = False
        pref.scopes = []
        pref.consented_at = None
        pref.consent_version = ""
        pref.backfill_done = False
        pref.save()


def ack_notice(user):
    pref = _preference(user)
    today = athlete_today(user)
    pref.notice_acked_on = today
    pref.save(update_fields=["notice_acked_on", "updated_at"])
    AthleteOrder.objects.filter(user=user, date=today).update(notified=True)


def send_due_pushes(now=None):
    from push_notifications.sender import send_push_to_user

    now = now or timezone.now()
    sent = 0
    prefs = RecoveryPreference.objects.filter(
        morning_push_enabled=True,
        morning_push_minute__isnull=False,
    ).select_related("user")
    for pref in prefs:
        user = pref.user
        now_local = now.astimezone(athlete_zone(user))
        if not push_is_due(
            now_local,
            chosen_minute=pref.morning_push_minute,
            quiet_start=pref.quiet_start_minute,
            quiet_end=pref.quiet_end_minute,
            already_sent=pref.push_sent_on == now_local.date(),
        ):
            continue
        orders = list(
            AthleteOrder.objects.filter(user=user, date=now_local.date())
            .select_related("config__persona", "config__competition")
        )
        if not orders:
            continue
        order = orders[0]
        persona = order.config.persona
        title = f"{persona.name}: Order of the Day" if persona is not None else "Order of the Day"
        body = ((order.voice or order.brief) or "")[:180]
        try:
            delivered = send_push_to_user(
                user,
                title=title,
                body=body,
                url="/",
                tag=f"readiness-{now_local.date().isoformat()}",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Readiness push failed for user %s: %s", user.pk, exc)
            delivered = 0
        if delivered:
            pref.push_sent_on = now_local.date()
            pref.save(update_fields=["push_sent_on", "updated_at"])
            AthleteOrder.objects.filter(pk__in=[item.pk for item in orders]).update(notified=True)
            sent += 1
    return sent


def sweep(now=None):
    """Refresh every athlete in a running coached challenge, phrase empty
    orders, then send morning pushes that are due and outside quiet hours."""
    from competition.models import Competition

    server_today = timezone.localdate()
    competitions = Competition.objects.filter(
        start_date__lte=server_today,
        end_date__gte=server_today,
        drill_instructor__enabled=True,
    ).prefetch_related("user")
    seen = set()
    for competition in competitions:
        # The m2m is ``competition.user`` (related name on CustomUser.my_competitions).
        for user in competition.user.all():
            if user.pk in seen:
                continue
            seen.add(user.pk)
            try:
                refresh_athlete(user, with_voice=True)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Readiness refresh failed for user %s: %s", user.pk, exc)
    pushed = send_due_pushes(now)
    return {"athletes": len(seen), "pushed": pushed}


def issue_personal_orders(config, participants) -> int:
    """Used by the morning order job. Returns how many athletes received a personal order."""
    count = 0
    for user in participants:
        try:
            _snapshot, orders = refresh_athlete(user, with_voice=True)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Personal order failed for user %s: %s", user.pk, exc)
            continue
        if any(order.config_id == config.pk for order in orders):
            count += 1
    return count


def setting_payload(competition):
    setting = ChallengeReadinessSetting.objects.filter(competition=competition).first()
    return {
        "competition_id": competition.pk,
        "listen_bonus_enabled": bool(setting and setting.listen_bonus_enabled),
        "listen_bonus_points": 3 if setting is None else setting.listen_bonus_points,
    }

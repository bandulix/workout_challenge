"""Personal Order of the Day, chosen from the readiness band.

The prescription is code, not the model. The persona only phrases it.
A red day is recovery even when the Drill Sergeant is furious: the
spec cannot be an all-out session, and a bark that orders one is
replaced with the recovery brief.
"""

from __future__ import annotations

import logging
import re

from django.utils import timezone

from .score import DISCLAIMER

logger = logging.getLogger(__name__)

RECOVERY_SPORTS = {"Walk", "Yoga", "Pilates", "PhysicalTherapy"}
EASY_SPIN_SPORTS = {"Ride", "VirtualRide", "EBikeRide", "EMountainBikeRide"}

# A red-day bark that asks for this is discarded. The brief stands.
ALL_OUT = re.compile(
    r"\b(all[-\s]?out|intervals?|personal records?|\bprs?\b|max(?:imum)? effort|"
    r"sprints?|beast mode|go hard|bury yourself|crush (?:it|them|this))\b",
    re.IGNORECASE,
)

RED_BRIEF = "Recovery day. A walk, some mobility, or an easy spin. Protect the streak."
AMBER_BRIEF = "Moderate day. Thirty steady minutes. Technique over power."


def safe_voice(band: str, voice: str, brief: str) -> str:
    text = (voice or "").strip()
    if band == "red" and (not text or ALL_OUT.search(text)):
        return brief
    return text or brief


def prescribe(band: str, *, echo=None, typical_minutes=None) -> dict | None:
    """Return kind, spec, brief for a band. None when there is no band."""
    if band == "red":
        return {
            "kind": "recovery",
            "spec": {
                "sports": sorted(RECOVERY_SPORTS),
                "easy_spin": sorted(EASY_SPIN_SPORTS),
                "min_minutes": 10,
                "max_intensity": 2,
                "protect_streak": True,
            },
            "brief": RED_BRIEF,
        }
    if band == "amber":
        return {
            "kind": "moderate",
            "spec": {"minutes": 30, "max_intensity": 3, "focus": "technique"},
            "brief": AMBER_BRIEF,
        }
    if band != "green":
        return None
    if echo is not None:
        unit = "km" if echo.metric == "distance" else "min"
        title = echo.title or "the mark"
        value = echo.metric_value
        return {
            "kind": "beat_mark",
            "spec": {
                "echo_id": echo.pk,
                "title": title,
                "metric": echo.metric,
                "metric_value": value,
                "sport_type": echo.sport_type,
            },
            "brief": f"Push day. Beat the mark on {title}: more than {value:g} {unit}.",
        }
    typical = typical_minutes or 30
    try:
        typical = float(typical)
    except (TypeError, ValueError):
        typical = 30
    minutes = max(30, min(75, int(typical * 1.2 + 0.5)))
    return {
        "kind": "push",
        "spec": {"minutes": minutes},
        "brief": f"Push day. Stretch goal: {minutes} minutes. Beat yesterday's version of you.",
    }


def _minutes(workout) -> float:
    duration = getattr(workout, "duration", None)
    if duration is None:
        return 0
    return duration.total_seconds() / 60.0


def workout_satisfies(order, workout) -> bool:
    """Whether this workout is the order. Recovery never accepts an all-out."""
    spec = order.spec or {}
    kind = order.kind
    minutes = _minutes(workout)
    intensity = getattr(workout, "intensity_category", None) or 2
    try:
        intensity = int(intensity)
    except (TypeError, ValueError):
        intensity = 2
    sport = getattr(workout, "sport_type", "") or ""
    if kind == "recovery":
        if minutes < int(spec.get("min_minutes") or 10):
            return False
        cap = int(spec.get("max_intensity") or 2)
        if sport in RECOVERY_SPORTS or sport in set(spec.get("sports") or []):
            return intensity <= cap
        easy = set(spec.get("easy_spin") or EASY_SPIN_SPORTS)
        return sport in easy and intensity <= cap
    if kind == "moderate":
        return minutes >= int(spec.get("minutes") or 30) and intensity <= int(spec.get("max_intensity") or 3)
    if kind == "push":
        return minutes >= int(spec.get("minutes") or 30)
    if kind == "beat_mark":
        try:
            from drill_instructor.echoes import _same_echo_sport
            same = _same_echo_sport(sport, spec.get("sport_type"))
        except Exception:  # noqa: BLE001
            same = sport == spec.get("sport_type")
        if not same:
            return False
        target = float(spec.get("metric_value") or 0)
        if spec.get("metric") == "distance":
            return float(getattr(workout, "distance", None) or 0) > target
        return minutes > target
    return False


def _live_echo(config, user):
    from drill_instructor.models import LegendEcho

    return (
        LegendEcho.objects.filter(
            config=config,
            status__in=(LegendEcho.STATUS_UNDEFEATED, LegendEcho.STATUS_CONTESTED),
        )
        .exclude(holder=user)
        .order_by("-metric_value", "-power")
        .first()
    )


def _typical_minutes(user, today):
    from datetime import timedelta

    from workouts.models import Workout

    start = timezone.now() - timedelta(days=28)
    durations = []
    rows = (
        Workout.objects.filter(user=user, start_datetime__gte=start)
        .exclude(sport_type="Steps")
        .order_by("-start_datetime")
        .values_list("duration", flat=True)[:8]
    )
    for duration in rows:
        if duration is None:
            continue
        minutes = duration.total_seconds() / 60.0
        if minutes > 0:
            durations.append(minutes)
    if not durations:
        return 30
    durations.sort()
    return durations[len(durations) // 2]


def compose_voice(persona, *, band: str, brief: str, why: str, athlete_name: str) -> str:
    from drill_instructor.llm_client import generate_message

    prompt = (
        f"You are issuing ONE athlete's private Order of the Day to {athlete_name or 'the athlete'}. "
        f"The band is {band or 'unknown'}. The order, which you must deliver in substance, is: \"{brief}\" "
        f"You may mention this reason, and no other numbers: \"{why}\". "
        "Write one or two short sentences in your persona's voice. Name no other athlete. "
        "Do not give medical advice. "
    )
    if band == "red":
        prompt += (
            "This is a RED recovery day. You may be tough, blunt, or disappointed, "
            "but the order is recovery only: a walk, mobility, or an easy spin, and you "
            "must mention protecting the streak. Do not order intervals, a PR, max effort, "
            "a sprint, or an all-out session."
        )
    elif band == "green":
        prompt += "This is a GREEN day: push, either the stretch goal or beating the mark. Make it feel earned."
    else:
        prompt += "This is an AMBER day: a moderate or technique session, not an all-out."
    body = ""
    try:
        body, _err = generate_message(
            system_prompt=persona.system_prompt,
            language=getattr(persona, "language", None),
            user_prompt=prompt,
            require_athlete_name=False,
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("Readiness voice fell back: %s", exc)
        body = ""
    return safe_voice(band, body or "", brief)[:500]


def order_payload(order) -> dict:
    text = (order.voice or "").strip() or order.brief
    competition = order.config.competition
    return {
        "id": order.pk,
        "date": order.date.isoformat(),
        "kind": order.kind,
        "brief": text,
        "instruction": order.brief,
        "why": order.why,
        "band": order.band,
        "score": order.score,
        "spec": order.spec or {},
        "completed": bool(order.completed),
        "private": True,
        "competition_id": competition.pk,
        "competition_name": competition.name,
        "disclaimer": DISCLAIMER,
    }


def on_workout_logged(workout):
    """Complete this athlete's personal orders for the workout's local morning.

    The existing +5 order bonus still applies (one row per workout per
    challenge). The listen bonus is a second award and only when the
    owner has turned it on.
    """
    from .models import AthleteOrder, athlete_today

    user = workout.user
    day = athlete_today(user, workout.start_datetime)
    orders = (
        AthleteOrder.objects.filter(user=user, date=day, completed=False)
        .select_related("config", "config__competition")
    )
    completed = 0
    for order in orders:
        if not workout_satisfies(order, workout):
            continue
        order.completed = True
        order.workout = workout
        order.save(update_fields=["completed", "workout", "updated_at"])
        completed += 1
        _grant(order, workout)
    return completed


def _grant(order, workout):
    from competition.scorer import grant_listen_bonus, grant_order_bonus

    from .models import ChallengeReadinessSetting

    competition = order.config.competition
    try:
        grant_order_bonus(workout, competition)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Order bonus skipped for user %s: %s", workout.user_id, exc)
    setting = ChallengeReadinessSetting.objects.filter(competition=competition).first()
    if setting is None or not setting.listen_bonus_enabled:
        return
    points = int(setting.listen_bonus_points or 0)
    if points <= 0:
        return
    try:
        grant_listen_bonus(workout, competition, points)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Listen bonus skipped for user %s: %s", workout.user_id, exc)

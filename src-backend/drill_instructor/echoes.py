"""Legend Echoes: mint, challenge, claim, immortalize.

Standout workouts become claimable trophies. Detection is rule-based so
a missing LLM still mints; the coach's voice is a best-effort overlay.
"""

from __future__ import annotations

import datetime
import logging

from django.apps import apps
from django.db import IntegrityError, transaction
from django.db.models import Max, Prefetch, Sum
from django.utils import timezone

from .game import _minutes, award_tag

logger = logging.getLogger(__name__)

CHALLENGE_DAYS = 7
DEFENSES_TO_IMMORTAL = 3
MAX_LIVE_ECHOES = 6
COOLDOWN = datetime.timedelta(hours=72)
MIN_DURATION_MIN = 30
SKIP_SPORTS = {"Steps"}


def _name(user):
    return (user.first_name or user.username or "Athlete").strip() or "Athlete"


def _metric_for(workout):
    minutes = _minutes(workout)
    distance = float(workout.distance) if workout.distance else 0
    if distance >= 8 and distance * 4 >= minutes:
        return "distance", round(distance, 2)
    return "duration", float(minutes)


def _aware(dt):
    if dt is None:
        return None
    if timezone.is_naive(dt):
        return timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _beats(workout, echo, committed_at=None):
    if workout.user_id == echo.holder_id:
        return False
    if echo.sport_type and workout.sport_type != echo.sport_type:
        return False
    start = _aware(workout.start_datetime)
    if committed_at is not None and start is not None and start < _aware(committed_at):
        return False
    competition = echo.config.competition if getattr(echo, "config_id", None) else None
    if competition is not None and start is not None:
        day = timezone.localtime(start).date()
        if day < competition.start_date or day > competition.end_date:
            return False
    if echo.metric == "distance":
        value = float(workout.distance or 0)
    else:
        value = float(_minutes(workout))
    return value > echo.metric_value


def _personal_best(workout, competition):
    Workout = apps.get_model("workouts", "Workout")
    minutes = _minutes(workout)
    if minutes < MIN_DURATION_MIN:
        return False
    best = Workout.objects.filter(
        user=workout.user,
        start_datetime__date__gte=competition.start_date,
        start_datetime__date__lte=competition.end_date,
        sport_type=workout.sport_type,
    ).exclude(pk=workout.pk).aggregate(m=Max("duration"))["m"]
    if not best:
        return False
    return workout.duration is not None and workout.duration > best


def _overtake(workout, competition):
    Points = apps.get_model("competition", "Points")
    per_user = list(
        Points.objects.filter(goal__competition=competition)
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
        .order_by("-total")
    )
    if len(per_user) < 2:
        return False
    if per_user[0].get("workout__user") != workout.user_id:
        return False
    without = list(
        Points.objects.filter(goal__competition=competition)
        .exclude(workout=workout)
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
        .order_by("-total")
    )
    if not without:
        return True
    return without[0].get("workout__user") != workout.user_id


def _mythic_size(workout):
    minutes = _minutes(workout)
    distance = float(workout.distance or 0)
    return minutes >= 90 or distance >= 15


def _power(workout, *, pb, overtake):
    minutes = _minutes(workout)
    distance = float(workout.distance or 0)
    score = min(70, minutes) + min(20, distance)
    if pb:
        score += 8
    if overtake:
        score += 12
    if _mythic_size(workout):
        score += 10
    return max(1, min(100, int(round(score))))


def judge_echo(workout, config):
    """Why this workout is (or isn't) Echo material. None = skip."""
    if workout.sport_type in SKIP_SPORTS:
        return None
    if _minutes(workout) < MIN_DURATION_MIN and float(workout.distance or 0) < 8:
        return None
    competition = config.competition
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    live = LegendEcho.objects.filter(
        config=config,
        status__in=("undefeated", "contested"),
    )
    if live.count() >= MAX_LIVE_ECHOES:
        return None
    if live.filter(origin_user=workout.user, created_at__gte=timezone.now() - COOLDOWN).exists():
        return None
    if LegendEcho.objects.filter(origin_workout=workout, config=config).exists():
        return None
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    if EchoChallenge.objects.filter(resolving_workout=workout, echo__config=config).exists():
        return None

    pb = _personal_best(workout, competition)
    overtake = _overtake(workout, competition)
    mythic = _mythic_size(workout)
    first = not LegendEcho.objects.filter(config=config).exists() and _minutes(workout) >= 40
    if not (pb or overtake or mythic or first):
        return None
    reasons = []
    if overtake:
        reasons.append("clutch overtake")
    if pb:
        reasons.append("personal best")
    if mythic:
        reasons.append("mythic size")
    if first:
        reasons.append("first flag of the challenge")
    return {"pb": pb, "overtake": overtake, "mythic": mythic, "first": first, "reasons": reasons}


def mint_echo(workout, config, judgment=None):
    """Create a Legend Echo for this workout. None if not warranted."""
    judgment = judgment or judge_echo(workout, config)
    if not judgment:
        return None
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    DogTag = apps.get_model("drill_instructor", "DogTag")
    persona = config.persona
    metric, value = _metric_for(workout)
    power = _power(workout, pb=judgment["pb"], overtake=judgment["overtake"])
    if DogTag.objects.filter(user=workout.user, slug="echo_immortal").exists():
        power = min(100, power + 5)
    athlete = _name(workout.user)
    unit = "km" if metric == "distance" else "min"
    title = f"{athlete}'s {workout.sport_type} Echo"
    fallback = (
        f"{persona.name}: @{athlete} just planted a Legend Echo — "
        f"{value:g} {unit} of {workout.sport_type}. Power {power}. "
        f"It sits undefeated until someone silences it."
    )
    prompt = (
        f"Competition: {config.competition.name}. @{athlete} just earned a "
        f"LEGEND ECHO for a {workout.sport_type} ({value:g} {unit}). "
        f"Reasons: {', '.join(judgment['reasons'])}. Power {power}. "
        "Write 2-4 sentences in your persona voice declaring this a living "
        "trophy. Taunt the rest of the group to come claim it. Name @{athlete}. "
        "Do not invent other names."
    )
    narrative = None
    try:
        from .llm_client import generate_message
        narrative, _err = generate_message(
            system_prompt=persona.system_prompt, user_prompt=prompt,
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("Echo narrative fell back for workout %s: %s", workout.pk, exc)
    try:
        echo = LegendEcho.objects.create(
            config=config,
            origin_user=workout.user,
            origin_workout=workout,
            holder=workout.user,
            holder_workout=workout,
            title=title[:80],
            narrative=(narrative or fallback)[:2000],
            power=power,
            metric=metric,
            metric_value=value,
            sport_type=workout.sport_type,
            status=LegendEcho.STATUS_UNDEFEATED,
        )
    except IntegrityError:
        logger.info("Duplicate Echo mint suppressed for workout %s", workout.pk)
        return None
    body = echo.narrative
    try:
        from .tasks import _post_coach_line
        _post_coach_line(config, DrillInstructorMessage.KIND_ECHO, body)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Echo mint post failed for workout %s: %s", workout.pk, exc)
    logger.info("Minted Legend Echo %s for workout %s in config %s", echo.pk, workout.pk, config.pk)
    return echo


def attach_echo_image(workout, config, image_field):
    """Copy a roast poster onto the Echo minted from this workout, if any."""
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    echo = LegendEcho.objects.filter(config=config, origin_workout=workout).first()
    if echo is None or echo.image:
        return echo
    if not image_field:
        return echo
    try:
        from django.core.files.base import ContentFile
        image_field.open("rb")
        try:
            data = image_field.read()
        finally:
            image_field.close()
        echo.image.save(f"echo-{echo.pk}.png", ContentFile(data), save=True)
    except Exception as exc:  # noqa: BLE001
        logger.info("Echo image attach skipped for %s: %s", echo.pk, exc)
    return echo


def live_echo_lines(config, limit=3):
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    rows = (
        LegendEcho.objects.filter(
            config=config,
            status__in=("undefeated", "contested"),
        )
        .select_related("holder")
        .order_by("-power", "-created_at")[:limit]
    )
    lines = []
    for echo in rows:
        unit = "km" if echo.metric == "distance" else "min"
        lines.append(
            f"Still waiting for someone to silence {_name(echo.holder)}'s "
            f"{echo.title} ({echo.metric_value:g} {unit}, power {echo.power})."
        )
    return lines


def start_challenge(echo, user, now=None):
    """Commit `user` to beating this Echo. Raises ValueError on refusal."""
    now = now or timezone.now()
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    expire_challenges(now)
    with transaction.atomic():
        echo = (
            LegendEcho.objects.select_for_update()
            .select_related("config", "config__competition", "config__persona", "holder")
            .get(pk=echo.pk)
        )
        if echo.status not in (LegendEcho.STATUS_UNDEFEATED, LegendEcho.STATUS_CONTESTED):
            raise ValueError("This Echo can no longer be challenged.")
        if echo.config.competition.end_date < timezone.localdate():
            raise ValueError("This challenge is over.")
        if echo.holder_id == user.id:
            raise ValueError("You already hold this Echo.")
        if not echo.config.competition.user.filter(pk=user.id).exists():
            raise ValueError("Only challenge members can contest an Echo.")
        if EchoChallenge.objects.filter(echo=echo, status=EchoChallenge.STATUS_ACTIVE).exists():
            raise ValueError("Someone is already coming for this Echo.")
        if EchoChallenge.objects.filter(
            challenger=user, status=EchoChallenge.STATUS_ACTIVE,
            echo__config=echo.config,
        ).exists():
            raise ValueError("Finish your current challenge first.")

        end = _aware(now + datetime.timedelta(days=CHALLENGE_DAYS))
        comp_end = _aware(datetime.datetime.combine(
            echo.config.competition.end_date, datetime.time.max,
        ))
        window_end = min(end, comp_end)
        if window_end <= now:
            raise ValueError("This challenge is over.")
        challenge = EchoChallenge.objects.create(
            echo=echo, challenger=user, window_end=window_end,
        )
        echo.status = LegendEcho.STATUS_CONTESTED
        echo.save(update_fields=["status"])

    persona = echo.config.persona
    challenger = _name(user)
    holder = _name(echo.holder)
    body = (
        f"{persona.name}: @{challenger} just declared war on @{holder}'s "
        f"{echo.title}. Beat {echo.metric_value:g} "
        f"{'km' if echo.metric == 'distance' else 'min'} of {echo.sport_type} "
        f"before the clock runs out. The group is watching."
    )
    try:
        from .tasks import _post_coach_line
        _post_coach_line(echo.config, DrillInstructorMessage.KIND_ECHO, body)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Echo challenge post failed: %s", exc)
    return challenge


def claim_echo(echo, winner, workout):
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    previous = echo.holder
    metric, value = _metric_for(workout)
    unit = "km" if metric == "distance" else "min"
    power = max(echo.power or 1, _power(workout, pb=False, overtake=True))
    echo.holder = winner
    echo.holder_workout = workout
    echo.chain_length = (echo.chain_length or 1) + 1
    echo.status = LegendEcho.STATUS_UNDEFEATED
    echo.last_claimed_at = timezone.now()
    echo.metric = metric
    echo.metric_value = value
    echo.sport_type = workout.sport_type or echo.sport_type
    echo.power = min(100, power)
    echo.title = f"{_name(winner)}'s {echo.sport_type} Echo"[:80]
    echo.save(update_fields=[
        "holder", "holder_workout", "chain_length", "status", "last_claimed_at",
        "metric", "metric_value", "sport_type", "power", "title",
    ])
    award_tag(winner, "echo_slayer")
    persona = echo.config.persona
    body = (
        f"{persona.name}: @{_name(winner)} just silenced @{_name(previous)}'s "
        f"Echo with {value:g} {unit} of {echo.sport_type}. "
        f"The bar is now {value:g} {unit}. Chain {echo.chain_length}. "
        f"@{_name(previous)} — your feat started a war. That is Legacy."
    )
    try:
        from .tasks import _post_coach_line
        _post_coach_line(echo.config, DrillInstructorMessage.KIND_CLAIM, body)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Echo claim post failed: %s", exc)
    return echo


def immortalize(echo):
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    if echo.status == LegendEcho.STATUS_IMMORTAL:
        return echo
    echo.status = LegendEcho.STATUS_IMMORTAL
    echo.immortalized_at = timezone.now()
    echo.save(update_fields=["status", "immortalized_at"])
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    EchoChallenge.objects.filter(
        echo=echo, status=EchoChallenge.STATUS_ACTIVE,
    ).update(status=EchoChallenge.STATUS_LOST)
    award_tag(echo.origin_user, "echo_immortal")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    body = (
        f"{echo.config.persona.name}: {echo.title} is IMMORTAL. "
        f"@{_name(echo.origin_user)} planted it. Chain {echo.chain_length}. "
        f"Nobody takes this one. It goes in the Book."
    )
    try:
        from .tasks import _post_coach_line
        _post_coach_line(echo.config, DrillInstructorMessage.KIND_ECHO, body)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Echo immortal post failed: %s", exc)
    return echo


def resolve_workout_challenges(workout, config):
    """If this workout beats an Echo the athlete challenged, they claim it."""
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    now = timezone.now()
    expire_challenges(now)
    claimed = []
    with transaction.atomic():
        active = (
            EchoChallenge.objects.select_for_update()
            .filter(
                challenger=workout.user,
                status=EchoChallenge.STATUS_ACTIVE,
                echo__config=config,
                echo__status__in=("undefeated", "contested"),
                window_end__gte=now,
            )
            .select_related(
                "echo", "echo__holder", "echo__config",
                "echo__config__persona", "echo__config__competition",
            )
        )
        for challenge in active:
            echo = challenge.echo
            if not _beats(workout, echo, committed_at=challenge.committed_at):
                continue
            challenge.status = EchoChallenge.STATUS_WON
            challenge.resolving_workout = workout
            challenge.save(update_fields=["status", "resolving_workout"])
            claim_echo(echo, workout.user, workout)
            claimed.append(echo)
    return claimed


def expire_challenges(now=None):
    """Close windows that ran out; immortalize Echoes that have earned it."""
    now = now or timezone.now()
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    expired = 0
    immortal = 0
    with transaction.atomic():
        due_rows = list(
            EchoChallenge.objects.select_for_update()
            .filter(status=EchoChallenge.STATUS_ACTIVE, window_end__lt=now)
            .select_related("echo", "echo__config", "echo__config__persona", "echo__origin_user")
        )
        for challenge in due_rows:
            challenge.status = EchoChallenge.STATUS_EXPIRED
            challenge.save(update_fields=["status"])
            echo = challenge.echo
            echo.defenses = (echo.defenses or 0) + 1
            if echo.defenses >= DEFENSES_TO_IMMORTAL:
                immortalize(echo)
                immortal += 1
            else:
                echo.status = LegendEcho.STATUS_UNDEFEATED
                echo.save(update_fields=["defenses", "status"])
            expired += 1

        today = timezone.localdate()
        finished = LegendEcho.objects.filter(
            status__in=(LegendEcho.STATUS_UNDEFEATED, LegendEcho.STATUS_CONTESTED),
            config__competition__end_date__lt=today,
        ).select_related("config", "config__persona", "origin_user")
        for echo in finished:
            immortalize(echo)
            immortal += 1
    return {"expired": expired, "immortal": immortal}


def book_payload(competition):
    """Season chronicle of every Echo in this challenge."""
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    echoes = (
        LegendEcho.objects.filter(config__competition=competition)
        .select_related("origin_user", "holder")
        .prefetch_related(Prefetch(
            "challenges",
            queryset=EchoChallenge.objects.select_related("challenger").order_by("committed_at"),
        ))
        .order_by("-chain_length", "-power", "created_at")
    )
    chapters = []
    for echo in echoes:
        wars = echo.challenges.all()
        chapters.append({
            "id": echo.id,
            "title": echo.title,
            "narrative": echo.narrative,
            "power": echo.power,
            "status": echo.status,
            "chain_length": echo.chain_length,
            "origin_name": _name(echo.origin_user),
            "holder_name": _name(echo.holder),
            "wars": [
                {
                    "challenger": _name(c.challenger),
                    "status": c.status,
                    "committed_at": c.committed_at.isoformat(),
                }
                for c in wars
            ],
        })
    return {
        "competition": competition.name,
        "chapters": chapters,
        "echo_count": len(chapters),
        "immortal_count": sum(1 for c in chapters if c["status"] == "immortal"),
    }

"""Legend Echoes: mint, auto-claim, immortalize.

Standout workouts become living trophies on the feed. A harder session
in the same sport family takes the relic — no war button.
"""

from __future__ import annotations

import datetime
import logging

from django.apps import apps
from django.db import IntegrityError, transaction
from django.db.models import Case, IntegerField, Max, Sum, Value, When
from django.utils import timezone

from .game import _minutes, award_tag

logger = logging.getLogger(__name__)


def _prompt_text(value, limit=80):
    """Flatten user-facing strings before they enter an LLM prompt."""
    return " ".join(str(value or "").split())[:limit]


CHALLENGE_DAYS = 7
DEFENSES_TO_IMMORTAL = 3
MAX_LIVE_ECHOES = 6
COOLDOWN = datetime.timedelta(hours=72)
MIN_DURATION_MIN = 30
SKIP_SPORTS = {"Steps"}
# Profile-pic crown: anyone currently holding a living or immortal Echo.
LIVE_HOLDER_STATUSES = ("undefeated", "contested", "immortal")

# Close variants share one Echo trophy. Road bike and gravel bike are
# the same fight; a treadmill run can claim a trail Echo. E-bikes stay
# off the human-powered cycling family. Unlisted sports stay themselves.
_ECHO_FAMILY_MEMBERS = {
    "Ride": (
        "Ride", "GravelRide", "MountainBikeRide", "VirtualRide",
        "Handcycle", "Velomobile",
    ),
    "EBikeRide": ("EBikeRide", "EMountainBikeRide"),
    "Run": ("Run", "TrailRun", "VirtualRun"),
    "Rowing": ("Rowing", "VirtualRow"),
    "Walk": ("Walk", "Snowshoe"),
    "MartialArts": ("MartialArts", "MuayThai", "Boxing", "Kickboxing"),
    "Ski": ("AlpineSki", "BackcountrySki", "NordicSki", "RollerSki"),
}
_ECHO_FAMILY_LABEL = {
    "Ride": "Cycling",
    "EBikeRide": "E-Bike",
    "Run": "Run",
    "Rowing": "Rowing",
    "Walk": "Walk",
    "MartialArts": "Martial Arts",
    "Ski": "Ski",
}
_SPORT_TO_FAMILY = {
    sport: family
    for family, sports in _ECHO_FAMILY_MEMBERS.items()
    for sport in sports
}


def echo_sport_family(sport_type):
    """Canonical Echo sport key for this workout type."""
    sport = sport_type or ""
    return _SPORT_TO_FAMILY.get(sport, sport)


def echo_sport_types(sport_type):
    """All workout types that share this Echo trophy."""
    family = echo_sport_family(sport_type)
    return _ECHO_FAMILY_MEMBERS.get(family) or ((sport_type,) if sport_type else ())


def echo_sport_label(sport_type):
    """Human name for titles and coach lines."""
    family = echo_sport_family(sport_type)
    return _ECHO_FAMILY_LABEL.get(family, family)


def bump_echo_holder_stats(competition_id):
    """Leaderboard avatars read echoes_held from the stats snapshot."""
    if not competition_id:
        return
    try:
        from custom_user.point_recalc import bump_stats_generation
        bump_stats_generation([competition_id])
    except Exception:  # noqa: BLE001
        pass


def delete_echo(echo):
    """Erase an Echo: wars, art file, then the row. Holder counts refresh.

    Coach feed lines stay (they are the chronicle, not the trophy). Dog
    tags earned from this Echo stay too. Holder crowns (echoes_held)
    are recount from remaining live/immortal Echoes.
    """
    competition_id = echo.config.competition_id
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    EchoChallenge.objects.filter(echo=echo).delete()
    if echo.image:
        name = echo.image.name
        try:
            echo.image.delete(save=False)
        except Exception as exc:  # noqa: BLE001 - row must still go
            logger.info("Echo art file %s not removed: %s", name, exc)
    echo.delete()
    bump_echo_holder_stats(competition_id)


def _name(user):
    return (user.first_name or user.username or "Athlete").strip() or "Athlete"


def pictured_first(qs):
    """Echoes with art float above crown placeholders; power still ranks inside each group."""
    return qs.annotate(
        has_art=Case(
            When(image="", then=Value(0)),
            When(image__isnull=True, then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        ),
    ).order_by("-has_art", "-power", "-created_at")


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


def _same_echo_sport(workout_sport, echo_sport):
    """Walk and TrailRun are different fights. Missing sport never matches."""
    workout_family = echo_sport_family(workout_sport)
    echo_family = echo_sport_family(echo_sport)
    if not workout_family or not echo_family:
        return False
    return workout_family == echo_family


def _beats(workout, echo, committed_at=None):
    if workout.user_id == echo.holder_id:
        return False
    if not _same_echo_sport(workout.sport_type, echo.sport_type):
        return False
    start = _aware(workout.start_datetime)
    anchor = committed_at or echo.last_claimed_at or echo.created_at
    if start is not None and anchor is not None and start < _aware(anchor):
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
        sport_type__in=echo_sport_types(workout.sport_type),
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
    if LegendEcho.objects.filter(holder_workout=workout, config=config).exists():
        return None

    pb = _personal_best(workout, competition)
    overtake = _overtake(workout, competition)
    mythic = _mythic_size(workout)
    family = echo_sport_family(workout.sport_type)
    first = (
        bool(family)
        and not LegendEcho.objects.filter(config=config, sport_type=family).exists()
        and _minutes(workout) >= 40
    )
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
    sport = echo_sport_label(workout.sport_type)
    title = f"{athlete}'s {sport} Echo"
    fallback = (
        f"{persona.name}: @{athlete} just planted a Legend Echo — "
        f"{value:g} {unit} of {sport}. Power {power}. "
        f"It sits undefeated until someone logs a harder session."
    )
    prompt = (
        f"Competition: {config.competition.name}. @{athlete} just earned a "
        f"LEGEND ECHO for a {sport} ({value:g} {unit}). "
        f"Reasons: {', '.join(judgment['reasons'])}. Power {power}. "
        "Write 2-4 sentences in your persona voice declaring this a living "
        "trophy on the feed. The next athlete to beat that mark takes it. "
        "Name @{athlete}. Do not invent other names."
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
        with transaction.atomic():
            # Serialize mints per config so concurrent workers cannot
            # push past MAX_LIVE_ECHOES (judge_echo alone is racy).
            DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
            locked_config = DrillInstructorConfig.objects.select_for_update().get(pk=config.pk)
            live_count = LegendEcho.objects.filter(
                config_id=locked_config.pk,
                status__in=("undefeated", "contested"),
            ).count()
            if live_count >= MAX_LIVE_ECHOES:
                logger.info(
                    "Echo mint skipped for workout %s: live cap %s reached under lock",
                    workout.pk, MAX_LIVE_ECHOES,
                )
                return None
            if LegendEcho.objects.filter(origin_workout=workout, config_id=locked_config.pk).exists():
                return None
            echo = LegendEcho.objects.create(
                config=locked_config,
                origin_user=workout.user,
                origin_workout=workout,
                holder=workout.user,
                holder_workout=workout,
                title=title[:80],
                narrative=(narrative or fallback)[:2000],
                power=power,
                metric=metric,
                metric_value=value,
                sport_type=echo_sport_family(workout.sport_type),
                status=LegendEcho.STATUS_UNDEFEATED,
            )
    except IntegrityError:
        logger.info("Duplicate Echo mint suppressed for workout %s", workout.pk)
        return None
    logger.info("Minted Legend Echo %s for workout %s in config %s", echo.pk, workout.pk, config.pk)
    bump_echo_holder_stats(config.competition_id)
    return echo


def attach_echo_image(workout, config, image_field):
    """Copy the activity photo onto Echoes this workout currently holds."""
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    if not image_field or workout is None:
        return 0
    echoes = list(LegendEcho.objects.filter(config=config, holder_workout=workout))
    if not echoes:
        return 0
    try:
        from django.core.files.base import ContentFile
        image_field.open("rb")
        try:
            data = image_field.read()
        finally:
            image_field.close()
    except Exception as exc:  # noqa: BLE001
        logger.info("Echo image read skipped for workout %s: %s", workout.pk, exc)
        return 0
    attached = 0
    for echo in echoes:
        try:
            echo.image.save(f"echo-{echo.pk}.jpg", ContentFile(data), save=True)
            attached += 1
        except Exception as exc:  # noqa: BLE001
            logger.info("Echo image attach skipped for %s: %s", echo.pk, exc)
    return attached


def process_echoes(workout, config):
    """Claim any Echo this workout beats; otherwise mint if it is a standout."""
    claimed = claim_beaten_echoes(workout, config)
    if claimed:
        return claimed
    echo = mint_echo(workout, config)
    return [echo] if echo else []


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


def claim_echo(echo, winner, workout):
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
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
    echo.sport_type = echo_sport_family(workout.sport_type) or echo.sport_type
    echo.power = min(100, power)
    echo.title = f"{_name(winner)}'s {echo_sport_label(echo.sport_type)} Echo"[:80]
    echo.save(update_fields=[
        "holder", "holder_workout", "chain_length", "status", "last_claimed_at",
        "metric", "metric_value", "sport_type", "power", "title",
    ])
    bump_echo_holder_stats(echo.config.competition_id)
    award_tag(winner, "echo_slayer")
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
        f"Nobody takes this one."
    )
    try:
        from .tasks import _post_coach_line
        _post_coach_line(echo.config, DrillInstructorMessage.KIND_ECHO, body, image_field=echo.image)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Echo immortal post failed: %s", exc)
    return echo


def claim_beaten_echoes(workout, config):
    """Anyone who beats a live Echo's mark takes it. No war to declare."""
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    claimed = []
    with transaction.atomic():
        live = list(
            LegendEcho.objects.select_for_update()
            .filter(
                config=config,
                status__in=(LegendEcho.STATUS_UNDEFEATED, LegendEcho.STATUS_CONTESTED),
            )
            .select_related(
                "holder", "config", "config__persona", "config__competition",
            )
        )
        for echo in live:
            if not _beats(workout, echo):
                continue
            EchoChallenge.objects.filter(
                echo=echo, status=EchoChallenge.STATUS_ACTIVE,
            ).update(status=EchoChallenge.STATUS_LOST)
            claim_echo(echo, workout.user, workout)
            claimed.append(echo)
    return claimed


def expire_challenges(now=None):
    """Close leftover wars and immortalize Echoes when the season ends."""
    now = now or timezone.now()
    EchoChallenge = apps.get_model("drill_instructor", "EchoChallenge")
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    expired = 0
    immortal = 0
    with transaction.atomic():
        due_rows = list(
            EchoChallenge.objects.select_for_update()
            .filter(status=EchoChallenge.STATUS_ACTIVE)
            .select_related("echo")
        )
        for challenge in due_rows:
            challenge.status = EchoChallenge.STATUS_EXPIRED
            challenge.save(update_fields=["status"])
            echo = challenge.echo
            if echo.status == LegendEcho.STATUS_CONTESTED:
                echo.status = LegendEcho.STATUS_UNDEFEATED
                echo.save(update_fields=["status"])
            expired += 1

        today = timezone.localdate()
        finished = list(
            LegendEcho.objects.select_for_update()
            .filter(
                status__in=(LegendEcho.STATUS_UNDEFEATED, LegendEcho.STATUS_CONTESTED),
                config__competition__end_date__lt=today,
            )
            .select_related("config", "config__persona", "origin_user")
        )
        for echo in finished:
            immortalize(echo)
            immortal += 1
    return {"expired": expired, "immortal": immortal}

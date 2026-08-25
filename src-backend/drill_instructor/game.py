"""Coach-arcade rules: daily orders, dunce crown, mood, dog tags.

Kept out of tasks.py so the API serializers and the beat jobs share one
implementation (and tests can call it without Celery).
"""

from __future__ import annotations

import datetime
import logging
import random

from django.apps import apps
from django.db.models import Sum
from django.utils import timezone

logger = logging.getLogger(__name__)


TAG_CATALOG = {
    "first_blood": {
        "title": "First Blood",
        "blurb": "First scorer in a live challenge.",
    },
    "ghost_killer": {
        "title": "Ghost Killer",
        "blurb": "Went from the dunce megaphone to first place.",
    },
    "photogenic": {
        "title": "Photogenic",
        "blurb": "Posted a photo the coach bothered to roast.",
    },
    "never_missed_monday": {
        "title": "Never Missed Monday",
        "blurb": "Logged a workout on three different Mondays.",
    },
    "survived_the_dunce": {
        "title": "Survived the Dunce",
        "blurb": "Wore the megaphone and logged anyway.",
    },
    "echo_immortal": {
        "title": "Echo Immortal",
        "blurb": "Planted a Legend Echo that nobody could silence.",
    },
    "echo_slayer": {
        "title": "Echo Slayer",
        "blurb": "Claimed someone else's Legend Echo.",
    },
}

MOODS = {
    "unleashed": {
        "key": "unleashed",
        "label": "Unleashed",
        "line": "The field is on fire. Nobody sits this one out.",
        "intensity": 3,
    },
    "proud": {
        "key": "proud",
        "label": "Proud",
        "line": "Half the squad showed up. That's a start. Don't waste it.",
        "intensity": 2,
    },
    "watching": {
        "key": "watching",
        "label": "Watching",
        "line": "A few of you moved. The rest of you are on notice.",
        "intensity": 1,
    },
    "disappointed": {
        "key": "disappointed",
        "label": "Disappointed",
        "line": "Forty-eight hours. Silence. Do better.",
        "intensity": 0,
    },
}


def _local_date(dt):
    if dt is None:
        return timezone.localdate()
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return timezone.localtime(dt).date()


def _minutes(workout):
    if workout.duration is None:
        return 0
    return round(workout.duration.total_seconds() / 60)


def _day_minutes(user, day):
    Workout = apps.get_model("workouts", "Workout")
    start = datetime.datetime.combine(day, datetime.time.min)
    end = datetime.datetime.combine(day, datetime.time.max)
    tz = timezone.get_current_timezone()
    if timezone.is_naive(start):
        start = timezone.make_aware(start, tz)
        end = timezone.make_aware(end, tz)
    qs = Workout.objects.filter(user=user, start_datetime__range=(start, end))
    total = 0
    for w in qs:
        total += _minutes(w)
    return total


def award_tag(user, slug):
    """Idempotent: returns the tag row, created=True on first earn."""
    DogTag = apps.get_model("drill_instructor", "DogTag")
    if slug not in TAG_CATALOG:
        return None, False
    tag, created = DogTag.objects.get_or_create(
        user=user, slug=slug, defaults={"earned_at": timezone.now()}
    )
    return tag, created


def tag_payload(user):
    DogTag = apps.get_model("drill_instructor", "DogTag")
    rows = list(DogTag.objects.filter(user=user).order_by("earned_at"))
    return [
        {
            "slug": t.slug,
            "title": TAG_CATALOG.get(t.slug, {}).get("title", t.slug),
            "blurb": TAG_CATALOG.get(t.slug, {}).get("blurb", ""),
            "earned_at": t.earned_at.isoformat(),
        }
        for t in rows
    ]


def coach_mood(config, now=None):
    """Mood of one competition's coach from the last 48 hours of the field."""
    now = now or timezone.now()
    window = now - datetime.timedelta(hours=48)
    competition = config.competition
    Workout = apps.get_model("workouts", "Workout")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    participants = list(competition.user.all())
    n_part = max(len(participants), 1)
    workouts = Workout.objects.filter(user__in=participants, start_datetime__gte=window)
    n_workouts = workouts.count()
    n_active = workouts.values("user").distinct().count()
    window_24 = now - datetime.timedelta(hours=24)
    workouts_24 = Workout.objects.filter(user__in=participants, start_datetime__gte=window_24)
    n_workouts_24 = workouts_24.count()
    n_active_24 = workouts_24.values("user").distinct().count()
    n_photos = DrillInstructorMessage.objects.filter(
        config=config,
        kind=DrillInstructorMessage.KIND_PHOTO,
        posted_at__gte=window,
    ).count()

    if n_workouts == 0 and n_photos == 0:
        mood = dict(MOODS["disappointed"])
    else:
        ratio = n_active / n_part
        if ratio >= 0.8 or n_workouts >= n_part * 2:
            mood = dict(MOODS["unleashed"])
        elif ratio >= 0.5:
            mood = dict(MOODS["proud"])
        else:
            mood = dict(MOODS["watching"])
    mood["workouts_48h"] = n_workouts
    mood["active_48h"] = n_active
    mood["workouts_24h"] = n_workouts_24
    mood["active_24h"] = n_active_24
    mood["participants"] = n_part
    return mood


def pick_last_place(competition):
    """The lowest scorer among members. None if the board isn't real yet."""
    Points = apps.get_model("competition", "Points")
    members = list(competition.user.all())
    if len(members) < 2:
        return None
    totals = {
        row["workout__user"]: row["total"] or 0
        for row in Points.objects.filter(goal__competition=competition)
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
    }
    scored = [u for u in members if totals.get(u.id, 0) > 0]
    if len(scored) < 2:
        return None
    ranked = sorted(scored, key=lambda u: (totals.get(u.id, 0), u.id))
    last, first = ranked[0], ranked[-1]
    if totals.get(last.id, 0) == totals.get(first.id, 0):
        return None  # everyone tied
    return last


def crown_dunce(config, user):
    """Put the megaphone on ``user``. No-op if they already wear it."""
    if config.dunce_id == (user.id if user else None):
        return False
    config.dunce = user
    config.dunce_since = timezone.now() if user else None
    config.save(update_fields=["dunce", "dunce_since", "updated_at"])
    return True


def clear_dunce(config, user):
    """If ``user`` wears the megaphone, take it off and award the tag."""
    if config.dunce_id != user.id:
        return False
    config.dunce = None
    config.dunce_since = None
    config.save(update_fields=["dunce", "dunce_since", "updated_at"])
    award_tag(user, "survived_the_dunce")
    return True


def draw_order_spec(config, today, participants):
    """Pick a viable order kind + spec for this field. No DB write."""
    yesterday = today - datetime.timedelta(days=1)
    kinds = ["log_one", "min_minutes"]
    from .llm_client import read_cached_capabilities
    vision, _edit = read_cached_capabilities()
    if vision:
        kinds.append("photo_proof")

    rival = None
    rival_minutes = 0
    if len(participants) >= 2:
        scored = []
        for u in participants:
            mins = _day_minutes(u, yesterday)
            if mins > 0:
                scored.append((u, mins))
        if scored:
            rival, rival_minutes = random.choice(scored)
            kinds.append("beat_rival")

    kind = random.choice(kinds)
    spec = {}
    if kind == "min_minutes":
        spec["minutes"] = random.choice([20, 30, 40])
        brief = f"Log at least {spec['minutes']} minutes today. No excuses."
    elif kind == "beat_rival":
        spec["rival_id"] = rival.id
        spec["rival_name"] = rival.first_name or rival.username or "your rival"
        spec["rival_minutes"] = rival_minutes
        brief = (
            f"Beat @{spec['rival_name']}'s {rival_minutes} min from yesterday "
            "before the day is done."
        )
    elif kind == "photo_proof":
        brief = "Post photo proof on one of your workouts. The coach wants receipts."
    else:
        brief = "Log one workout today. That's the whole order. Do it."
    return kind, spec, brief


def user_satisfies_order(order, user):
    spec = order.spec or {}
    if order.kind == "log_one":
        return _day_minutes(user, order.date) > 0
    if order.kind == "min_minutes":
        return _day_minutes(user, order.date) >= int(spec.get("minutes") or 20)
    if order.kind == "beat_rival":
        return _day_minutes(user, order.date) > int(spec.get("rival_minutes") or 0)
    if order.kind == "photo_proof":
        DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
        start = datetime.datetime.combine(order.date, datetime.time.min)
        end = datetime.datetime.combine(order.date, datetime.time.max)
        tz = timezone.get_current_timezone()
        if timezone.is_naive(start):
            start = timezone.make_aware(start, tz)
            end = timezone.make_aware(end, tz)
        return DrillInstructorMessage.objects.filter(
            config=order.config,
            kind=DrillInstructorMessage.KIND_PHOTO,
            user=user,
            posted_at__range=(start, end),
        ).exists()
    return False


def mark_order_complete(order, user):
    if order.completed_by.filter(pk=user.id).exists():
        return False
    if not user_satisfies_order(order, user):
        return False
    order.completed_by.add(user)
    return True


def evaluate_workout_game(workout, config):
    """Dunce clear + order complete + tags after a workout is logged."""
    user = workout.user
    was_dunce = config.dunce_id == user.id
    if was_dunce:
        clear_dunce(config, user)

    today = _local_date(workout.start_datetime)
    DailyOrder = apps.get_model("drill_instructor", "DailyOrder")
    order = DailyOrder.objects.filter(config=config, date=today).first()
    if order:
        mark_order_complete(order, user)

    # First Blood: first points-producing workout in this challenge.
    Points = apps.get_model("competition", "Points")
    others = (
        Points.objects.filter(goal__competition=config.competition)
        .exclude(workout__user=user)
        .exists()
    )
    mine_before = (
        Points.objects.filter(goal__competition=config.competition, workout__user=user)
        .exclude(workout=workout)
        .exists()
    )
    if not others and not mine_before:
        award_tag(user, "first_blood")

    # Ghost Killer: was the dunce, now leading.
    if was_dunce:
        per_user = list(
            Points.objects.filter(goal__competition=config.competition)
            .values("workout__user")
            .annotate(total=Sum("points_capped"))
            .order_by("-total")
        )
        if per_user and per_user[0].get("workout__user") == user.id and len(per_user) >= 2:
            award_tag(user, "ghost_killer")

    # Never Missed Monday: three distinct Mondays with a workout.
    if _local_date(workout.start_datetime).weekday() == 0:
        Workout = apps.get_model("workouts", "Workout")
        mondays = set()
        for dt in Workout.objects.filter(user=user).values_list("start_datetime", flat=True):
            d = _local_date(dt)
            if d.weekday() == 0:
                mondays.add(d)
        if len(mondays) >= 3:
            award_tag(user, "never_missed_monday")

    try:
        from .echoes import mint_echo, resolve_workout_challenges
        resolve_workout_challenges(workout, config)
        mint_echo(workout, config)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Echo resolve/mint failed for workout %s: %s", workout.pk, exc)


def evaluate_photo_game(photo_message):
    """Photogenic tag + photo_proof order after a photo lands."""
    user = photo_message.user
    if user is None:
        return
    award_tag(user, "photogenic")
    today = _local_date(photo_message.posted_at)
    DailyOrder = apps.get_model("drill_instructor", "DailyOrder")
    order = DailyOrder.objects.filter(config=photo_message.config, date=today, kind="photo_proof").first()
    if order:
        mark_order_complete(order, user)


def order_payload(order, request_user=None):
    completers = [
        {
            "id": u.id,
            "first_name": u.first_name or u.username,
        }
        for u in order.completed_by.all()
    ]
    mine = False
    if request_user is not None and request_user.is_authenticated:
        mine = any(c["id"] == request_user.id for c in completers)
    return {
        "id": order.id,
        "date": order.date.isoformat(),
        "kind": order.kind,
        "brief": order.brief,
        "spec": order.spec or {},
        "completed": mine,
        "completers": completers,
        "failed_announced": order.failed_announced,
        "competition_id": order.config.competition_id,
        "competition_name": order.config.competition.name,
    }


def dunce_payload(config):
    if not config.dunce_id:
        return None
    u = config.dunce
    return {
        "user_id": u.id,
        "first_name": u.first_name or u.username,
        "since": config.dunce_since.isoformat() if config.dunce_since else None,
        "competition_id": config.competition_id,
    }

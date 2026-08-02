import datetime
import logging
import random

from django.apps import apps
from django.db.models import Sum
from django.utils import timezone

from workout_challenge.celery import app

from .llm_client import build_group_push_prompt, build_inactivity_prompt, build_workout_prompt, generate_message

try:
    from push_notifications.sender import send_push_to_user
except ImportError:  # pragma: no cover - keeps the module importable for tests
    send_push_to_user = None

logger = logging.getLogger(__name__)


def _persona_icon(persona):
    """Push-notification icon for a persona. Custom uploaded pictures are
    NOT used: they live behind the authenticated picture endpoint, and the
    browser fetches notification icons without credentials. Built-in
    artwork key, else no icon."""
    import re as _re

    if persona.avatar and _re.fullmatch(r"[a-z0-9_-]+", persona.avatar):
        return f"/personas/{persona.avatar}.svg"
    return None


def _recent_bodies(config, limit=2):
    """The persona's last ``limit`` message bodies for this config.

    Passed into the prompt builders so the instructor can refer back to
    its own recent messages (continuity, callbacks) and avoid repeating
    itself. Test messages are previews, not conversation; failed
    generations never reached the group - both are excluded.
    """
    return list(
        config.messages
        .exclude(kind="test")
        .filter(success=True)
        .order_by("-posted_at")
        .values_list("body", flat=True)[:limit]
    )


def _format_workout_summary(workout):
    """Build a human-readable one-liner of the workout (used as a fallback)."""
    parts = []
    duration_min = None
    if workout.duration is not None:
        duration_min = round(workout.duration.total_seconds() / 60)
        parts.append(f"{duration_min} min {workout.sport_type}")
    if workout.distance is not None and workout.sport_type != "Steps":
        parts.append(f"{float(workout.distance):.2f} km")
    if workout.kcal is not None:
        parts.append(f"{round(float(workout.kcal))} kcal")
    return " · ".join(parts), duration_min


def _user_rank(workout, competition):
    """Compute this user's rank, totals and the leaderboard "target" user.

    Returns ``(rank, total_participants, my_total, leader_total, target_user)``.

    ``target_user`` is the person the instructor should address in the
    message:
      * if the athlete is not leading, the leader
      * if the athlete IS leading, the runner-up (so we have someone
        to call out for the leader to "watch out for")

    Falls back to ``None`` if the competition has fewer than two
    scored participants.
    """
    Points = apps.get_model("competition", "Points")

    my_total = (
        Points.objects
        .filter(goal__competition=competition, workout__user=workout.user_id)
        .aggregate(total=Sum("points_capped"))
    )["total"] or 0

    per_user = list(
        Points.objects
        .filter(goal__competition=competition)
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
        .order_by("-total")
    )

    if not per_user:
        return None, 0, 0, 0, None

    leader_total = per_user[0]["total"] or 0
    target_user_id = None
    if per_user[0]["workout__user"] == workout.user_id and len(per_user) > 1:
        target_user_id = per_user[1]["workout__user"]
    elif per_user[0]["workout__user"] != workout.user_id:
        target_user_id = per_user[0]["workout__user"]

    target_user = None
    if target_user_id is not None:
        CustomUser = apps.get_model("custom_user", "CustomUser")
        target_user = CustomUser.objects.filter(pk=target_user_id).first()

    if my_total == 0:
        return None, len(per_user), 0, leader_total, target_user

    ahead = sum(1 for entry in per_user if (entry["total"] or 0) > my_total)
    return ahead + 1, len(per_user), my_total, leader_total, target_user


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def post_workout_comment(self, workout_id):
    """Generate a Drill Instructor comment for a workout and store it.

    For every competition this workout belongs to that has an enabled
    Drill Instructor, generate one AI-voiced comment, persist it to
    ``DrillInstructorMessage`` so the competition owner can read it from
    the audit log, and (optionally) send a web push to the athlete.
    """
    Workout = apps.get_model("workouts", "Workout")
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    try:
        workout = Workout.objects.select_related("user").get(pk=workout_id)
    except Workout.DoesNotExist:
        logger.info("Drill Instructor: workout %s no longer exists, skipping.", workout_id)
        return {"skipped": "workout_missing"}

    start_dt = workout.start_datetime
    if isinstance(start_dt, str):
        start_dt = datetime.datetime.fromisoformat(start_dt.replace("Z", "+00:00"))

    Competition = apps.get_model("competition", "Competition")
    competitions = Competition.objects.filter(
        start_date__lte=start_dt.date(),
        end_date__gte=start_dt.date(),
        user=workout.user,
        drill_instructor__enabled=True,
        drill_instructor__comment_on_activity=True,
    ).select_related("drill_instructor", "drill_instructor__persona")

    summary, duration_min = _format_workout_summary(workout)

    posted = 0
    for competition in competitions:
        config = competition.drill_instructor
        persona = config.persona

        rank, total_participants, my_total, leader_total, target_user = _user_rank(workout, competition)
        user_prompt = build_workout_prompt(
            user_first_name=workout.user.first_name or workout.user.username or "Athlete",
            username=workout.user.username or "",
            sport_type=workout.sport_type,
            duration_minutes=duration_min or 0,
            distance_km=float(workout.distance) if workout.distance is not None else None,
            kcal=float(workout.kcal) if workout.kcal is not None else None,
            intensity=workout.intensity_category or 0,
            competition_name=competition.name,
            points_capped=None,
            user_rank=rank,
            total_participants=total_participants,
            leader_points=leader_total,
            user_total_points=my_total,
            target_first_name=(target_user.first_name if target_user else None),
            previous_messages=_recent_bodies(config),
        )

        body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=user_prompt)
        if not body:
            body = f"{persona.name}: nice work on that {summary or workout.sport_type}!"

        # Store the message in the in-app audit log so the owner can
        # read it back from the Drill Instructor "messages" endpoint.
        message = DrillInstructorMessage(
            config=config,
            kind=DrillInstructorMessage.KIND_ACTIVITY,
            workout=workout,
            body=body,
            posted_at=timezone.now(),
        )
        try:
            message.save()
            config.last_posted_at = timezone.now()
            config.messages_posted = (config.messages_posted or 0) + 1
            # Surface an LLM outage (message still posted as static
            # fallback); cleared again on the next successful generation.
            config.last_error = llm_error or ""
            config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
            posted += 1
            logger.info("Drill Instructor: stored message %s for competition %s", message.id, competition.id)
        except Exception as exc:  # noqa: BLE001 - never block workout saves
            message.success = False
            message.error = str(exc)[:2000]
            try:
                message.save()
            except Exception:  # pragma: no cover
                pass
            config.last_error = str(exc)[:2000]
            config.save(update_fields=["last_error", "updated_at"])
            logger.warning("Drill Instructor: message save failed for competition %s: %s", competition.id, exc)

        # Optional web push for the athlete.
        if config.send_push_on_activity and send_push_to_user is not None:
            try:
                send_push_to_user(
                    workout.user,
                    title=f"{competition.name} - {persona.name}",
                    body=body,
                    url=f"/coach",
                    icon=_persona_icon(persona),
                    badge="/icon-badge.png",
                    tag=f"drill-{competition.id}",
                )
            except Exception as exc:  # noqa: BLE001 - never block workout saves
                logger.warning("Drill Instructor: push failed for user %s: %s", workout.user_id, exc)

    return {"workout_id": workout_id, "posted": posted, "competitions": competitions.count()}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def post_test_message(self, config_id, message):
    """Store a one-off test message in the audit log.

    The competition owner triggered this from the Drill Instructor
    settings UI to preview how a message would look; we keep it in the
    audit log so they can re-read it.
    """
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    try:
        config = DrillInstructorConfig.objects.select_related("competition", "persona").get(pk=config_id)
    except DrillInstructorConfig.DoesNotExist:
        return {"error": "Config not found."}

    record = DrillInstructorMessage(
        config=config,
        kind=DrillInstructorMessage.KIND_TEST,
        workout=None,
        body=message,
        posted_at=timezone.now(),
    )
    try:
        record.save()
        return {"config_id": config_id, "id": record.id}
    except Exception as exc:  # noqa: BLE001
        record.success = False
        record.error = str(exc)[:2000]
        try:
            record.save()
        except Exception:  # pragma: no cover
            pass
        return {"error": str(exc), "config_id": config_id}


def _competition_leader(competition):
    """Return ``(leader_user, leader_points)`` for a competition, or
    ``(None, 0)`` when nobody has scored yet."""
    Points = apps.get_model("competition", "Points")

    top = (
        Points.objects
        .filter(goal__competition=competition)
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
        .order_by("-total")
        .first()
    )
    if not top:
        return None, 0

    CustomUser = apps.get_model("custom_user", "CustomUser")
    leader = CustomUser.objects.filter(pk=top["workout__user"]).first()
    return leader, top["total"] or 0


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def post_inactivity_nudges(self):
    """Post one motivational nudge in every running competition that went
    quiet today.

    Scheduled daily via Celery beat. For every competition that is
    currently running and has an enabled Drill Instructor with
    ``nudge_on_inactivity``:
      * if any participant logged a workout today -> skip
      * if a nudge was already posted today -> skip (idempotent re-runs)
      * otherwise generate one persona-voiced message addressed at the
        whole group, store it in the audit log, and (when the config's
        push toggle is on) push it to every subscribed participant.
    """
    Workout = apps.get_model("workouts", "Workout")
    Competition = apps.get_model("competition", "Competition")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    today = timezone.localdate()
    competitions = (
        Competition.objects
        .filter(
            start_date__lte=today,
            end_date__gte=today,
            drill_instructor__enabled=True,
            drill_instructor__nudge_on_inactivity=True,
        )
        .select_related("drill_instructor", "drill_instructor__persona")
        .prefetch_related("user")
    )

    posted = 0
    skipped = 0
    for competition in competitions:
        config = competition.drill_instructor
        persona = config.persona
        participants = list(competition.user.all())
        if not participants:
            skipped += 1
            continue

        # Any workout by any participant today? Then the group is active
        # and no nudge is needed.
        if Workout.objects.filter(user__in=participants, start_datetime__date=today).exists():
            skipped += 1
            continue

        # One nudge per competition per day - re-running the beat task
        # must not spam the feed.
        if config.messages.filter(kind=DrillInstructorMessage.KIND_NUDGE, posted_at__date=today).exists():
            skipped += 1
            continue

        leader, leader_points = _competition_leader(competition)
        user_prompt = build_inactivity_prompt(
            competition_name=competition.name,
            participant_first_names=[(u.first_name or u.username or "Athlete") for u in participants],
            leader_first_name=(leader.first_name or leader.username) if leader else None,
            leader_points=float(leader_points) if leader_points else None,
            days_left=(competition.end_date - today).days,
            previous_messages=_recent_bodies(config),
        )

        body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=user_prompt)
        if not body:
            body = (
                f"{persona.name}: quiet day in {competition.name} - "
                "nobody logged a workout. Who breaks the silence?"
            )

        message = DrillInstructorMessage(
            config=config,
            kind=DrillInstructorMessage.KIND_NUDGE,
            workout=None,
            body=body,
            posted_at=timezone.now(),
        )
        try:
            message.save()
            config.last_posted_at = timezone.now()
            config.messages_posted = (config.messages_posted or 0) + 1
            config.last_error = llm_error or ""
            config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
            posted += 1
            logger.info("Drill Instructor: stored inactivity nudge %s for competition %s", message.id, competition.id)
        except Exception as exc:  # noqa: BLE001 - one bad competition must not kill the sweep
            message.success = False
            message.error = str(exc)[:2000]
            try:
                message.save()
            except Exception:  # pragma: no cover
                pass
            config.last_error = str(exc)[:2000]
            config.save(update_fields=["last_error", "updated_at"])
            logger.warning("Drill Instructor: nudge save failed for competition %s: %s", competition.id, exc)
            continue

        # Optional web push to every participant (the nudge targets the
        # whole group, not a single athlete).
        if config.send_push_on_activity and send_push_to_user is not None:
            for participant in participants:
                try:
                    send_push_to_user(
                        participant,
                        title=f"{competition.name} - {persona.name}",
                        body=body,
                        url=f"/coach",
                        icon=_persona_icon(persona),
                        badge="/icon-badge.png",
                        tag=f"drill-nudge-{competition.id}",
                    )
                except Exception as exc:  # noqa: BLE001 - never block the sweep
                    logger.warning("Drill Instructor: nudge push failed for user %s: %s", participant.id, exc)

    return {"date": str(today), "posted": posted, "skipped": skipped, "competitions": competitions.count()}


# Random group pushes land in waking hours only - nobody wants the
# sergeant yelling at 03:00.
PUSH_WINDOW_START_HOUR = 7
PUSH_WINDOW_END_HOUR = 22
PUSH_MAX_PER_DAY = 2


def _draw_push_plan():
    """Draw today's random push slot(s): always exactly one, plus a 50%
    chance of a second one (kept at least 90 minutes from the first so
    they don't clump). Returns a sorted list of "HH:MM" strings."""
    start = PUSH_WINDOW_START_HOUR * 60
    end = PUSH_WINDOW_END_HOUR * 60
    first = random.randrange(start, end)
    slots = [first]
    if random.random() < 0.5:
        for _ in range(10):
            second = random.randrange(start, end)
            if abs(second - first) >= 90:
                slots.append(second)
                break
    return sorted(f"{m // 60:02d}:{m % 60:02d}" for m in slots)


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def post_random_pushes(self):
    """Post the instructor's random daily pep talk in every running
    competition that has it enabled (``random_push``).

    Scheduled every 30 min via Celery beat. Each competition draws its
    own random slot(s) once per day (stored on the config): always at
    least one, at most two, inside waking hours (07:00-22:00). When a
    drawn slot is due and not yet posted, generate one persona-voiced
    message addressed at the whole group, store it in the audit log, and
    (when the config's push toggle is on) push it to every subscribed
    participant. Re-runs are idempotent: the plan is drawn only once per
    day and already-posted slots are counted from the audit log.
    """
    Workout = apps.get_model("workouts", "Workout")
    Competition = apps.get_model("competition", "Competition")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    now = timezone.localtime()
    today = now.date()
    now_hhmm = f"{now.hour:02d}:{now.minute:02d}"
    competitions = (
        Competition.objects
        .filter(
            start_date__lte=today,
            end_date__gte=today,
            drill_instructor__enabled=True,
            drill_instructor__random_push=True,
        )
        .select_related("drill_instructor", "drill_instructor__persona")
        .prefetch_related("user")
    )

    posted = 0
    skipped = 0
    for competition in competitions:
        config = competition.drill_instructor
        persona = config.persona
        participants = list(competition.user.all())
        if not participants:
            skipped += 1
            continue

        # Draw today's random slot(s) once, then reuse them all day.
        if config.push_plan_date != today:
            config.push_plan = _draw_push_plan()
            config.push_plan_date = today
            config.save(update_fields=["push_plan", "push_plan_date", "updated_at"])
        plan = config.push_plan if isinstance(config.push_plan, list) else []

        # Hard cap + idempotency: what already went out today stays counted.
        posted_today = config.messages.filter(kind=DrillInstructorMessage.KIND_PUSH, posted_at__date=today).count()
        due_slots = [slot for slot in plan if slot <= now_hhmm]
        remaining = min(len(due_slots), PUSH_MAX_PER_DAY) - posted_today
        if remaining <= 0:
            skipped += 1
            continue

        leader, leader_points = _competition_leader(competition)

        for _ in range(remaining):
            # History is rebuilt per message so a same-run second push
            # sees the first one (and won't echo it).
            user_prompt = build_group_push_prompt(
                competition_name=competition.name,
                participant_first_names=[(u.first_name or u.username or "Athlete") for u in participants],
                leader_first_name=(leader.first_name or leader.username) if leader else None,
                leader_points=float(leader_points) if leader_points else None,
                days_left=(competition.end_date - today).days,
                workouts_today=Workout.objects.filter(user__in=participants, start_datetime__date=today).count(),
                previous_messages=_recent_bodies(config),
            )
            body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=user_prompt)
            if not body:
                body = (
                    f"{persona.name}: checking in on {competition.name} - "
                    "the day isn't over yet. Get a workout in!"
                )

            message = DrillInstructorMessage(
                config=config,
                kind=DrillInstructorMessage.KIND_PUSH,
                workout=None,
                body=body,
                posted_at=timezone.now(),
            )
            try:
                message.save()
                config.last_posted_at = timezone.now()
                config.messages_posted = (config.messages_posted or 0) + 1
                config.last_error = llm_error or ""
                config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
                posted += 1
                logger.info("Drill Instructor: stored random push %s for competition %s", message.id, competition.id)
            except Exception as exc:  # noqa: BLE001 - one bad competition must not kill the sweep
                message.success = False
                message.error = str(exc)[:2000]
                try:
                    message.save()
                except Exception:  # pragma: no cover
                    pass
                config.last_error = str(exc)[:2000]
                config.save(update_fields=["last_error", "updated_at"])
                logger.warning("Drill Instructor: random push save failed for competition %s: %s", competition.id, exc)
                break

            # Optional web push to every participant (the pep talk targets
            # the whole group, not a single athlete). The tag carries the
            # date so the two daily pushes don't replace each other.
            if config.send_push_on_activity and send_push_to_user is not None:
                for participant in participants:
                    try:
                        send_push_to_user(
                            participant,
                            title=f"{competition.name} - {persona.name}",
                            body=body,
                            url=f"/coach",
                            icon=_persona_icon(persona),
                            badge="/icon-badge.png",
                            tag=f"drill-push-{competition.id}-{today}",
                        )
                    except Exception as exc:  # noqa: BLE001 - never block the sweep
                        logger.warning("Drill Instructor: random push notification failed for user %s: %s", participant.id, exc)

    return {"date": str(today), "posted": posted, "skipped": skipped, "competitions": competitions.count()}

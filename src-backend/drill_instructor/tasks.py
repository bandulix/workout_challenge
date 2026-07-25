import datetime
import logging

from django.apps import apps
from django.db.models import Sum
from django.utils import timezone

from workout_challenge.celery import app

from .llm_client import build_workout_prompt, generate_message
from .matrix_client import MatrixError, send_text_message

try:
    from push_notifications.sender import send_push_to_user
except ImportError:  # pragma: no cover - keeps the module importable for tests
    send_push_to_user = None

logger = logging.getLogger(__name__)


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
    """Compute this user's capped-points rank within the competition.

    Two queries: one aggregates points per user (with the runner-up's
    score so we can break ties), one counts participants. Avoids
    scanning the whole per-user list in Python.
    """
    Points = apps.get_model("competition", "Points")
    from django.db.models import Count

    my_total = (
        Points.objects
        .filter(goal__competition=competition, workout__user=workout.user_id)
        .aggregate(total=Sum("points_capped"))
    )["total"] or 0

    if my_total == 0:
        return None, 0

    ahead = (
        Points.objects
        .filter(goal__competition=competition)
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
        .filter(total__gt=my_total)
        .count()
    )
    total = (
        Points.objects
        .filter(goal__competition=competition)
        .values("workout__user")
        .distinct()
        .aggregate(c=Count("workout__user"))
    )["c"]
    return ahead + 1, total


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def post_workout_comment(self, workout_id):
    """Post a single Drill Instructor comment for a workout.

    Walks every competition this workout belongs to, picks those that
    have an enabled Drill Instructor config, and posts once per config.
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

        rank, total_participants = _user_rank(workout, competition)
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
        )

        body = generate_message(system_prompt=persona.system_prompt, user_prompt=user_prompt)
        if not body:
            body = f"{persona.name}: nice work on that {summary or workout.sport_type}!"

        prefix = config.matrix_bot_display_name.strip()
        if prefix:
            body = f"[{prefix}] {body}"

        message = DrillInstructorMessage(
            config=config,
            workout=workout,
            body=body,
            posted_at=timezone.now(),
        )
        try:
            event_id = send_text_message(
                homeserver=config.matrix_homeserver,
                access_token=config.matrix_access_token,
                room_id=config.matrix_room_id,
                body=body,
            )
            message.matrix_event_id = event_id
            message.success = True
            message.save()
            config.last_posted_at = timezone.now()
            config.messages_posted = (config.messages_posted or 0) + 1
            config.last_error = ""
            config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
            posted += 1
        except MatrixError as exc:
            message.success = False
            message.error = str(exc)
            message.save()
            config.last_error = str(exc)[:2000]
            config.save(update_fields=["last_error", "updated_at"])
            logger.warning("Drill Instructor: Matrix post failed for competition %s: %s", competition.id, exc)

        # Browser push (optional per-config toggle).
        if config.send_push_on_activity and send_push_to_user is not None:
            try:
                send_push_to_user(
                    workout.user,
                    title=f"{competition.name} - {persona.name}",
                    body=body,
                    url=f"/competition/{competition.id}",
                )
            except Exception as exc:  # noqa: BLE001 - never block workout saves
                logger.warning("Drill Instructor: push failed for user %s: %s", workout.user_id, exc)

    return {"workout_id": workout_id, "posted": posted, "competitions": competitions.count()}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def post_test_message(self, config_id, message):
    """Send a one-off test message from the owner's settings UI."""
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    try:
        config = DrillInstructorConfig.objects.select_related("competition", "persona").get(pk=config_id)
    except DrillInstructorConfig.DoesNotExist:
        return {"error": "Config not found."}

    record = DrillInstructorMessage(
        config=config,
        workout=None,
        body=message,
        posted_at=timezone.now(),
    )
    try:
        event_id = send_text_message(
            homeserver=config.matrix_homeserver,
            access_token=config.matrix_access_token,
            room_id=config.matrix_room_id,
            body=message,
        )
        record.matrix_event_id = event_id
        record.success = True
        record.save()
        return {"event_id": event_id, "config_id": config_id}
    except MatrixError as exc:
        record.success = False
        record.error = str(exc)
        record.save()
        return {"error": str(exc), "config_id": config_id}

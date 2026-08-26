import logging
import datetime, random
from openai import OpenAI
from django.core.cache import cache
from django.conf import settings
from django.apps import apps
from django.template.loader import render_to_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from workout_challenge.celery import app
from django.db.models import Sum, Count
from django.db.models.functions import TruncDate, TruncDay

from .multipurpose import send_email, email_settings_context
from .context import base_email_context
from .tokens import email_verify_token
from competition.stats import get_competition_stats

logger = logging.getLogger(__name__)


def _user(user_pk):
    CustomUser = apps.get_model("custom_user", "CustomUser")
    return CustomUser.objects.filter(pk=user_pk).first()


def _send_user_email(user, subject, template, extra=None, require_verified=True):
    """Render ``template`` and send. Marketing mail requires a confirmed
    inbox; verify / password-reset pass ``require_verified=False``."""
    if user is None:
        return "user not found"
    if require_verified and not user.is_verified:
        return f"skip unverified user {user.pk}"
    ctx = {**base_email_context(user), **(extra or {})}
    with email_settings_context():
        email_body = render_to_string(template, ctx)
        if settings.DEBUG:
            with open("tmp_email.html", "w") as file:
                file.write(email_body)
        send_email(subject=subject, body=email_body, to_email=user.email)
    return {"pk": user.pk, "username": user.username, "email": user.email}


@app.task()
def verify_email(user_pk):
    """Short confirmation link. The only mail sent to an unconfirmed address."""
    user = _user(user_pk)
    if user is None:
        return f"user {user_pk} not found"
    if user.is_verified:
        return f"user {user_pk} already confirmed"
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = email_verify_token.make_token(user)
    verify_url = f"{settings.MAIN_HOST}/email/verify/{uid}/{token}/"
    return _send_user_email(
        user,
        subject="Workout Challenge — confirm your email",
        template="email_verify.html",
        extra={"VERIFY_URL": verify_url},
        require_verified=False,
    )


@app.task()
def welcome_email(user_pk):
    """Welcome mail after the address is confirmed."""
    user = _user(user_pk)
    extra = {"link_import_note": user is not None and user.get_activity_source() is None}
    return _send_user_email(
        user,
        subject="Welcome to the Workout Challenge",
        template="email_welcome.html",
        extra=extra,
    )


@app.task()
def send_all_log_workouts_email():
    logger.info("Scheduling log workout emails")
    CustomUser = apps.get_model("custom_user", "CustomUser")
    user_lst = CustomUser.objects.filter(
        is_verified=True,
        my_competitions__start_date__lte=datetime.date.today(),
        my_competitions__end_date__gte=datetime.date.today(),
    ).order_by("pk").distinct()
    task_log = []
    if len(user_lst) > 0:
        eta_steps = max(min((60 * 60) // len(user_lst), 60), 10)
        eta = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=10)
        for user_obj in user_lst:
            result = log_workouts_email.apply_async(args=[user_obj.pk], eta=eta)
            task_log.append({"pk": user_obj.pk, "username": user_obj.username, "email": user_obj.email, "task_id": result.task_id, "eta": eta.isoformat()})
            eta += datetime.timedelta(seconds=eta_steps)
    return task_log


@app.task()
def log_workouts_email(user_pk):
    """Email reminder for users to please log their workouts."""
    user = _user(user_pk)
    if user is None:
        return f"user {user_pk} not found"
    if not user.is_verified:
        return f"skip unverified user {user.pk}"
    extra = {
        "last_workouts": user.workout_set.order_by("-start_datetime")[:3],
        "link_import_note": user.get_activity_source() is None,
    }
    return _send_user_email(
        user,
        subject="Workout Challenge — log last week's workouts",
        template="email_log_workouts.html",
        extra=extra,
    )


@app.task()
def send_all_competition_start_email():
    logger.info("Scheduling competition start emails")
    Competition = apps.get_model("competition", "Competition")
    competition_lst = Competition.objects.filter(start_date=datetime.date.today() + datetime.timedelta(days=1)).order_by("pk")
    task_log = []
    for i, competition_obj in enumerate(competition_lst):
        eta = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=10) + datetime.timedelta(minutes=(15 * i))
        user_lst = competition_obj.user.filter(is_verified=True).order_by("pk")
        if len(user_lst) > 0:
            eta_steps = max(min((60 * 60) // len(user_lst), 60), 10)
            for user_obj in user_lst:
                result = competition_start_email.apply_async(args=[competition_obj.pk, user_obj.pk], eta=eta)
                task_log.append({"user_pk": user_obj.pk, "username": user_obj.username, "email": user_obj.email, "competition_pk": competition_obj.pk, "competition_name": competition_obj.name, "task_id": result.task_id, "eta": eta.isoformat()})
                eta += datetime.timedelta(seconds=eta_steps)
    return task_log


@app.task()
def competition_start_email(competition_pk, user_pk):
    """Email for competition start tomorrow."""
    Competition = apps.get_model("competition", "Competition")
    competition_obj = Competition.objects.get(pk=competition_pk)
    user = _user(user_pk)
    if user is None:
        return f"user {user_pk} not found"
    if not user.is_verified:
        return f"skip unverified user {user.pk}"
    extra = {
        "competition": competition_obj,
        "goals": competition_obj.activitygoal_set.all(),
        "goal_equalizer_note": user.scaling_kcal == 1 and user.scaling_distance == 1,
    }
    return _send_user_email(
        user,
        subject="Workout Challenge — ready, set, go",
        template="email_competition_start.html",
        extra=extra,
    )


@app.task()
def send_all_leaderboard_emails():
    logger.info("Scheduling leaderboard emails")
    CustomUser = apps.get_model("custom_user", "CustomUser")
    user_lst = CustomUser.objects.filter(
        is_verified=True,
        my_competitions__start_date__lt=datetime.date.today(),
        my_competitions__end_date__gte=datetime.date.today(),
    ).order_by("pk").distinct()
    task_log = []
    if len(user_lst) > 0:
        eta_steps = max(min((60 * 60) // len(user_lst), 60), 10)
        eta = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=10)
        for user_obj in user_lst:
            result = leaderboard_email.apply_async(args=[user_obj.pk], eta=eta)
            task_log.append({"pk": user_obj.pk, "username": user_obj.username, "email": user_obj.email, "task_id": result.task_id, "eta": eta.isoformat()})
            eta += datetime.timedelta(seconds=eta_steps)
    return task_log


@app.task()
def leaderboard_email(user_pk):
    """Email to send users their leaderboard."""
    user = _user(user_pk)
    if user is None:
        return f"user {user_pk} not found"
    if not user.is_verified:
        return f"skip unverified user {user.pk}"
    competition_all_data = []
    competition_7d_data = []
    for competition in user.my_competitions.filter(start_date__lte=datetime.date.today(), end_date__gte=datetime.date.today()).order_by("-start_date"):
        competition_all_stats = get_competition_stats(competition.pk)
        competition_all_data.append({
            "competition": competition_all_stats["competition"],
            "leaderboard": competition_all_stats["leaderboard"],
        })
        competition_7d_stats = get_competition_stats(competition.pk, last_seven_days=True)
        competition_7d_data.append({
            "competition": competition_7d_stats["competition"],
            "leaderboard": competition_7d_stats["leaderboard"],
        })
    extra = {
        "competitions_all": competition_all_data,
        "competitions_7d": competition_7d_data,
        "goal_equalizer_note": user.scaling_kcal == 1 and user.scaling_distance == 1,
    }
    return _send_user_email(
        user,
        subject="Workout Challenge — your spot on the board",
        template="email_leaderboard.html",
        extra=extra,
    )


@app.task()
def send_all_weekly_emails():
    logger.info("Scheduling weekly emails")
    CustomUser = apps.get_model("custom_user", "CustomUser")
    user_lst = CustomUser.objects.filter(is_verified=True, email_mid_week=True).order_by("pk")
    task_log = []
    if len(user_lst) > 0:
        eta_steps = max(min((60 * 60) // len(user_lst), 60), 10)
        eta = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=10)
        for user_obj in user_lst:
            result = weekly_email.apply_async(args=[user_obj.pk], eta=eta)
            task_log.append({"pk": user_obj.pk, "username": user_obj.username, "email": user_obj.email, "task_id": result.task_id, "eta": eta.isoformat()})
            eta += datetime.timedelta(seconds=eta_steps)
    return task_log


def openai_quote():

    from site_settings.models import resolve_llm_settings
    from drill_instructor.llm_client import _safe_base_url

    config = resolve_llm_settings()
    api_key = config["api_key"]
    if api_key is None:
        return None

    base_url = _safe_base_url(config["base_url"])

    todays_ai_quote = cache.get("todays_ai_quote", None)

    if todays_ai_quote is None:
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        client = OpenAI(**client_kwargs)
        options = ["fitness", "health", "nutritional", "workout"]
        selection = random.choice(options)
        response = client.chat.completions.create(
            model=config["email_model"],
            messages=[
                {"role": "user", "content": f"Tell me a one sentence {selection} fact."},
            ],
            temperature=1.0,
            top_p=1.0
        )
        todays_ai_quote = response.choices[0].message.content
        cache.set("todays_ai_quote", todays_ai_quote, 60 * 60 * 20)

        logger.info("Today AI quote: %s", todays_ai_quote)

    return todays_ai_quote


def calendar_stats(user_pk):
    today = datetime.date.today()

    days_until_sunday = (6 - today.weekday()) % 7
    next_sunday = today + datetime.timedelta(days=days_until_sunday)
    dates_list = [next_sunday - datetime.timedelta(days=i) for i in range(34, -1, -1)]

    Workout = apps.get_model("workouts", "Workout")
    all_workouts = Workout.objects.filter(user=user_pk).annotate(date=TruncDay("start_datetime")).values("date").annotate(count=Count("id"))
    workouts_by_date = {row["date"].date().isoformat(): row["count"] for row in all_workouts}
    workouts_by_week = {(settings.TIME_ZONE_OBJ.localize(datetime.datetime.combine(next_sunday, datetime.datetime.min.time())) - row["date"]).days // 7: True for row in all_workouts}

    streak_weeks = 0
    streak_i = 0
    streak_true = True
    while streak_true:
        if workouts_by_week.get(streak_i, False):
            streak_weeks += 1
        elif streak_i == 0:
            pass
        else:
            streak_true = False
        streak_i += 1

    return_calendar = []
    for date in dates_list:
        workout_num = workouts_by_date.get(date.isoformat(), 0)
        if workout_num > 0:
            color, background_color = "#0b0b0c", "#d7ff3e"
        elif date == today:
            color, background_color = "#d7ff3e", "#1c1c20"
        elif date > today:
            color, background_color = "#6b6b73", "#141416"
        else:
            color, background_color = "#3c3c46", "#101012"
        return_calendar.append({
            "datetime": date,
            "day": date.day,
            "workout_num": workout_num,
            "color": color,
            "background_color": background_color,
        })

    return streak_weeks, [return_calendar[i:i + 7] for i in range(0, len(return_calendar), 7)]


@app.task()
def weekly_email(user_pk):
    """Email to send users their weekly update."""
    user = _user(user_pk)
    if user is None:
        return f"user {user_pk} not found"
    if not user.is_verified:
        return f"skip unverified user {user.pk}"

    Workout = apps.get_model("workouts", "Workout")
    workout_7day_stats = Workout.objects.filter(
        user=user,
        start_datetime__gte=datetime.date.today() - datetime.timedelta(days=7)
    ).annotate(
        day=TruncDate("start_datetime")
    ).aggregate(
        total_duration=Sum("duration"),
        total_distance=Sum("distance"),
        distinct_days=Count("day", distinct=True)
    )

    week_streak, calendar = calendar_stats(user_pk)
    todays_ai_quote = openai_quote()

    recorded_total_duration = 0 if workout_7day_stats["total_duration"] is None else (workout_7day_stats["total_duration"].seconds // 60)
    recorded_total_distance = 0 if workout_7day_stats["total_distance"] is None else workout_7day_stats["total_distance"]
    recorded_distinct_days = 0 if workout_7day_stats["distinct_days"] is None else workout_7day_stats["distinct_days"]

    extra = {
        "calendar": calendar,
        "week_streak": week_streak,
        "goals": {
            "active_days": None if user.goal_active_days is None or user.goal_active_days == "" else {"recorded": recorded_distinct_days, "target": user.goal_active_days, "percent": min(1, recorded_distinct_days / user.goal_active_days) * 100, "percent_vml": int(min(1, recorded_distinct_days / user.goal_active_days) * 100 * 2.5)},
            "distance": None if user.goal_distance is None or user.goal_distance == "" else {"recorded": recorded_total_distance, "target": user.goal_distance, "percent": min(1, recorded_total_distance / user.goal_distance) * 100, "percent_vml": int(min(1, recorded_total_distance / user.goal_distance) * 100 * 2.5)},
            "minutes": None if user.goal_workout_minutes is None or user.goal_workout_minutes == "" else {"recorded": recorded_total_duration, "target": user.goal_workout_minutes, "percent": min(1, recorded_total_duration / user.goal_workout_minutes) * 100, "percent_vml": int(min(1, recorded_total_duration / user.goal_workout_minutes) * 100 * 2.5)},
        },
        "openai_quote": todays_ai_quote,
    }
    return _send_user_email(
        user,
        subject="Workout Challenge — your week",
        template="email_weekly.html",
        extra=extra,
    )


@app.task()
def password_reset_email(user_pk, reset_url):
    """Send the password reset email asynchronously.

    Queued (rather than sent inline in the request) so the HTTP
    response time is identical for known and unknown addresses -
    otherwise the sync SMTP round-trip leaks which emails are
    registered (user enumeration timing oracle).
    """
    user = _user(user_pk)
    if user is None:
        return f"user {user_pk} not found"
    result = _send_user_email(
        user,
        subject="Workout Challenge — reset your password",
        template="email_password_reset.html",
        extra={"RESET_URL": reset_url},
        require_verified=False,
    )
    if isinstance(result, dict):
        return f"password reset email queued for user {user_pk}"
    return result

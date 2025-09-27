"""Celery task config"""

import os

from celery import Celery
from celery.schedules import crontab

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "workout_challenge.settings")

app = Celery("workout_challenge")

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Load task modules from all registered Django apps.
app.autodiscover_tasks()

app.conf.beat_schedule = {
    # every morning import users strava workouts
    "strava_sync": {
        "task": "custom_user.strava.daily_strava_sync",
        "schedule": crontab(minute="44", hour="4"),
        "args": (),
    },
    # not needed - just fallback - do all pending point recalc tasks in the morning
    "point_recal": {
        "task": "custom_user.point_recalc.recalc_points",
        "schedule": crontab(minute="55", hour="5"),
        "args": (),
    },
    # every Monday morning ask people who didn't connect Strava to please log their workouts
    "send_all_log_workouts_email": {
        "task": "custom_user.emails.celery_emails.send_all_log_workouts_email",
        "schedule": crontab(day_of_week="1", minute="5", hour="9"),
        "args": (),
    },
    # every Monday afternoon send competition leaderboards out
    "send_all_leaderboard_emails": {
        "task": "custom_user.emails.celery_emails.send_all_leaderboard_emails",
        "schedule": crontab(day_of_week="1", minute="5", hour="15"),
        "args": (),
    },
    # every Thursday afternoon send weekly check-ins out
    "send_all_weekly_emails": {
        "task": "custom_user.emails.celery_emails.send_all_weekly_emails",
        "schedule": crontab(day_of_week="4", minute="5", hour="15"),
        "args": (),
    },
    # every day at noon send start competition email
    "send_all_competition_start_email": {
        "task": "custom_user.emails.celery_emails.send_all_competition_start_email",
        "schedule": crontab(minute="5", hour="12"),
        "args": (),
    },
}


def is_task_already_executing(task_name: str) -> bool:
    """Returns whether the task with given task_name is already being executed.

    Args:
        task_name: Name of the task to check if it is running currently.
    Returns: A boolean indicating whether the task with the given task name is
        running currently.
    """
    active_tasks = app.control.inspect().active()
    task_count = 0
    for worker, running_tasks in active_tasks.items():
        for task in running_tasks:
            if task["name"] == task_name:
                task_count += 1

    return task_count > 1
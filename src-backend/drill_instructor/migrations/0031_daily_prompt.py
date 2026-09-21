"""Owner-defined daily briefing: config field + message kind + beat job.

Schema: adds ``daily_prompt`` to the config (the challenge admin's own
words for what the coach posts about every morning) and the ``briefing``
message kind.

Data: seeds the PeriodicTask row the DatabaseScheduler needs - the
static ``beat_schedule`` dict in celery.py is documentation-only. The
sweep runs every 30 minutes; the task itself posts at most once per day,
first tick at/after 07:00 local.
"""

from django.conf import settings
from django.db import migrations, models


TASK_NAME = "drill_instructor_daily_prompt"
TASK_PATH = "drill_instructor.tasks.post_daily_prompts"


def seed_periodic_task(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="*/30",
        hour="*",
        day_of_week="*",
        day_of_month="*",
        month_of_year="*",
        timezone=getattr(settings, "TIME_ZONE", "UTC"),
    )
    task, created = PeriodicTask.objects.get_or_create(
        name=TASK_NAME,
        defaults={
            "task": TASK_PATH,
            "crontab": crontab,
            "enabled": True,
            "description": (
                "Every 30 min: post the owner-defined daily briefing (one "
                "persona-voiced morning post about the admin's topic) in "
                "every running competition that has a daily prompt set."
            ),
        },
    )
    if not created:
        changed = []
        if task.task != TASK_PATH:
            task.task = TASK_PATH
            changed.append("task")
        if task.crontab_id != crontab.id:
            task.crontab = crontab
            changed.append("crontab")
        if changed:
            task.save()


def remove_periodic_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name=TASK_NAME).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0030_persona_body_pictures"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="daily_prompt",
            field=models.CharField(
                blank=True,
                default="",
                help_text=(
                    "Topic for the coach's daily morning post, in the admin's own "
                    "words. The coach writes about it every day in persona style."
                ),
                max_length=500,
            ),
        ),
        migrations.AlterField(
            model_name="drillinstructormessage",
            name="kind",
            field=models.CharField(
                choices=[
                    ("activity", "Workout comment"),
                    ("test", "Test message"),
                    ("nudge", "Inactivity nudge"),
                    ("push", "Random group push"),
                    ("reply", "Participant reply"),
                    ("reaction", "Coach reaction"),
                    ("photo", "Participant photo post"),
                    ("order", "Daily order"),
                    ("sigh", "Order failure"),
                    ("dunce", "Dunce crowning"),
                    ("handover", "Weekly coach handover"),
                    ("echo", "Legend Echo minted"),
                    ("claim", "Legend Echo claimed"),
                    ("war", "Legend Echo war"),
                    ("briefing", "Daily owner briefing"),
                ],
                default="activity",
                help_text="What triggered this message (a workout, a test, a quiet-day nudge, a random group push, a participant reply, or the coach's reaction to one).",
                max_length=12,
            ),
        ),
        migrations.RunPython(seed_periodic_task, remove_periodic_task),
    ]

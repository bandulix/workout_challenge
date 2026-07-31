"""Seed the Celery beat PeriodicTask for the quiet-day nudge sweep.

Celery beat runs with ``django_celery_beat.schedulers:DatabaseScheduler``
(see supervisord.conf), which only reads ``PeriodicTask`` rows from the
database - the static ``beat_schedule`` dict in celery.py is ignored.
This data migration creates the row idempotently so the daily 17:10
inactivity nudge actually fires on every deployment.
"""

from django.conf import settings
from django.db import migrations


TASK_NAME = "drill_instructor_inactivity_nudge"
TASK_PATH = "drill_instructor.tasks.post_inactivity_nudges"


def seed_periodic_task(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="10",
        hour="17",
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
                "Daily early-evening sweep: post one Drill Instructor nudge "
                "in every running competition where nobody logged a workout today."
            ),
        },
    )
    if not created:
        # Keep the row pointing at the right task/crontab even if an admin
        # accidentally re-pointed it; never re-enable a row the admin
        # deliberately disabled.
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
        ("drill_instructor", "0006_drillinstructorconfig_nudge_on_inactivity_and_more"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(seed_periodic_task, remove_periodic_task),
    ]

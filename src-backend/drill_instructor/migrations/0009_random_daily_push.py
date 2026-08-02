"""Random daily group push: config fields + beat PeriodicTask.

Schema: adds ``random_push`` (toggle), ``push_plan_date``/``push_plan``
(the day's drawn random slots) and the ``push`` message kind.

Data: seeds the PeriodicTask row the DatabaseScheduler needs - the
static ``beat_schedule`` dict in celery.py is documentation-only. The
sweep runs every 30 minutes so the drawn random slots fire close to
their planned time.
"""

from django.conf import settings
from django.db import migrations, models


TASK_NAME = "drill_instructor_random_push"
TASK_PATH = "drill_instructor.tasks.post_random_pushes"


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
                "Every 30 min: post the Drill Instructor's random daily "
                "group push (1-2 persona-voiced pep talks per day at drawn "
                "times) in every running competition that has it enabled."
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
        ("drill_instructor", "0008_refresh_roast_master_prompt"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="random_push",
            field=models.BooleanField(
                default=True,
                help_text=(
                    "The instructor pushes the group 1-2 times per day at random "
                    "times (waking hours, 07:00-22:00) with a persona-voiced pep "
                    "talk - independent of whether anyone trained."
                ),
            ),
        ),
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="push_plan_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="push_plan",
            field=models.JSONField(blank=True, default=list),
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
                ],
                default="activity",
                help_text="What triggered this message (a workout, a test, a quiet-day nudge, or a random group push).",
                max_length=12,
            ),
        ),
        migrations.RunPython(seed_periodic_task, remove_periodic_task),
    ]

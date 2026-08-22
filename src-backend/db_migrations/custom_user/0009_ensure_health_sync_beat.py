# Re-seed / re-enable the hourly Health Connect import. Beat uses
# DatabaseScheduler; if the PeriodicTask row is missing or disabled,
# Open Wearables is polled only when someone taps Re-Sync.

from django.conf import settings
from django.db import migrations


TASK_NAME = "health_sync"
TASK_PATH = "custom_user.health.daily_health_sync"


def seed_periodic_task(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="34",
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
                "Hourly import of Apple Health / Health Connect workouts "
                "from the configured Open Wearables instance."
            ),
        },
    )
    changed = []
    if task.task != TASK_PATH:
        task.task = TASK_PATH
        changed.append("task")
    if task.crontab_id != crontab.id:
        task.crontab = crontab
        changed.append("crontab")
    if not task.enabled:
        task.enabled = True
        changed.append("enabled")
    if changed and not created:
        task.save()


def remove_periodic_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name=TASK_NAME).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("custom_user", "0008_customuser_health_linkage"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(seed_periodic_task, remove_periodic_task),
    ]

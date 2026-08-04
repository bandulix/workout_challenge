# Apple Health / Google Health Connect linkage via Open Wearables:
# new CustomUser fields + the Celery beat PeriodicTask for the hourly
# health sync (beat runs the DatabaseScheduler - see the drill_instructor
# 0007 migration for the seeding pattern).

from django.conf import settings
from django.db import migrations, models


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
                "from the configured Open Wearables instance (10 min before "
                "the Strava sweep, so syncs never compete)."
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
        ('custom_user', '0007_customuser_activity_source'),
        ('django_celery_beat', '0019_alter_periodictasks_options'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='health_last_synced_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='customuser',
            name='health_user_id',
            field=models.CharField(blank=True, max_length=40, null=True),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='activity_source',
            field=models.CharField(blank=True, choices=[('strava', 'Strava'), ('garmin', 'Garmin'), ('health', 'Apple/Google Health')], default=None, max_length=10, null=True),
        ),
        migrations.RunPython(seed_periodic_task, remove_periodic_task),
    ]

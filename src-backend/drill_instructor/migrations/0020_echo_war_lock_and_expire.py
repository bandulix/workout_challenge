"""One active Echo war per user; expire windows every 15 minutes.

0019 already shipped the Echo tables. This tightens the challenge lock
and retimes the beat job so lapsed wars do not sit until 21:20.
"""

from django.conf import settings
from django.db import migrations, models


def update_periodic_task(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    tz = getattr(settings, "TIME_ZONE", "UTC")
    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="*/15",
        hour="*",
        day_of_week="*",
        day_of_month="*",
        month_of_year="*",
        timezone=tz,
    )
    PeriodicTask.objects.filter(name="drill_instructor_echo_windows").update(
        crontab=crontab,
        task="drill_instructor.tasks.resolve_echo_windows",
        enabled=True,
    )


def revert_periodic_task(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    tz = getattr(settings, "TIME_ZONE", "UTC")
    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="20",
        hour="21",
        day_of_week="*",
        day_of_month="*",
        month_of_year="*",
        timezone=tz,
    )
    PeriodicTask.objects.filter(name="drill_instructor_echo_windows").update(crontab=crontab)


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0019_legend_echoes"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="echochallenge",
            constraint=models.UniqueConstraint(
                condition=models.Q(status="active"),
                fields=("challenger",),
                name="one_active_echo_war_per_user",
            ),
        ),
        migrations.RunPython(update_periodic_task, revert_periodic_task),
    ]

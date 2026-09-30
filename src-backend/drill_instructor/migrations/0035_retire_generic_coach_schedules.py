"""Disable repetitive generic coach pushes while preserving task history.

Workout comments and Echo events remain event-triggered. The old daily,
random, and inactivity schedules are retained as disabled PeriodicTask rows
for auditability and so existing configuration data is not destroyed.
"""

from django.db import migrations


RETIRED_TASK_NAMES = (
    "drill_instructor_inactivity_nudge",
    "drill_instructor_random_push",
    "drill_instructor_daily_prompt",
)


def disable_generic_coach_tasks(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name__in=RETIRED_TASK_NAMES).update(enabled=False)


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0034_comebacksupportoffer"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(disable_generic_coach_tasks, migrations.RunPython.noop),
    ]

# Echo wars are gone (succession is immediate): drop EchoChallenge and
# point the beat job at the season-end immortalization sweep.

from django.db import migrations


def rename_periodic_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name="drill_instructor_echo_windows").update(
        task="drill_instructor.tasks.immortalize_finished_echoes",
        description="*/15min: immortalize Echoes whose season has ended.",
    )


def revert_periodic_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name="drill_instructor_echo_windows").update(
        task="drill_instructor.tasks.resolve_echo_windows",
    )


class Migration(migrations.Migration):

    dependencies = [
        ('drill_instructor', '0028_alter_drillinstructormessage_kind_and_more'),
    ]

    operations = [
        migrations.RunPython(rename_periodic_task, revert_periodic_task),
        migrations.DeleteModel(
            name='EchoChallenge',
        ),
    ]

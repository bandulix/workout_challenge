"""Turn per-workout coach comments back on for coaches already on duty.

Commit 1b4463c stopped writing ``comment_on_activity`` and saved it as
false on every coach form submit. Enabled coaches comment on workouts
again regardless of that flag; this puts the stored flag back in line
so a later read does not look like the feature is off. Nudge and random
push schedules stay disabled.
"""

from django.db import migrations


def restore_workout_comments(apps, schema_editor):
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
    DrillInstructorConfig.objects.filter(enabled=True, comment_on_activity=False).update(
        comment_on_activity=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0038_alter_dogtag_slug_alter_drillinstructormessage_kind"),
    ]

    operations = [
        migrations.RunPython(restore_workout_comments, migrations.RunPython.noop),
    ]

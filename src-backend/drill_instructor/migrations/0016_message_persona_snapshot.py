# Snapshot the persona on each coach message so switching the
# competition's coach does not rewrite historical avatars in the feed.

import django.db.models.deletion
from django.db import migrations, models


def backfill_persona(apps, schema_editor):
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
    config_persona = dict(DrillInstructorConfig.objects.values_list("id", "persona_id"))
    for config_id, persona_id in config_persona.items():
        if persona_id:
            DrillInstructorMessage.objects.filter(
                config_id=config_id, persona_id__isnull=True,
            ).update(persona_id=persona_id)


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0015_photo_votes"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructormessage",
            name="persona",
            field=models.ForeignKey(
                blank=True,
                help_text="Persona that was on duty when this message was written.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="messages",
                to="drill_instructor.drillinstructorpersona",
            ),
        ),
        migrations.RunPython(backfill_persona, migrations.RunPython.noop),
    ]

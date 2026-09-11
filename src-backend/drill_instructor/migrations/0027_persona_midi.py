from django.db import migrations, models


def copy_config_midi_to_persona(apps, schema_editor):
    Config = apps.get_model("drill_instructor", "DrillInstructorConfig")
    qs = (
        Config.objects.exclude(midi="")
        .exclude(midi__isnull=True)
        .select_related("persona")
    )
    for cfg in qs:
        persona = cfg.persona
        if not persona or persona.midi:
            continue
        persona.midi = cfg.midi
        persona.save(update_fields=["midi"])


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0026_config_midi"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorpersona",
            name="midi",
            field=models.FileField(
                blank=True,
                help_text="Optional looping MIDI bed for this coach, played in the app while they are on duty.",
                null=True,
                upload_to="coach_midi/",
            ),
        ),
        migrations.RunPython(copy_config_midi_to_persona, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="drillinstructorconfig",
            name="midi",
        ),
    ]

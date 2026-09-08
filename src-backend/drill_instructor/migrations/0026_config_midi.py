from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0025_drop_global_echo_war_unique"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="midi",
            field=models.FileField(
                blank=True,
                help_text="Optional looping MIDI bed for this challenge's coach, played in the app.",
                null=True,
                upload_to="coach_midi/",
            ),
        ),
    ]

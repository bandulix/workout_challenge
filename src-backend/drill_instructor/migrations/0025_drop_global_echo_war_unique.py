from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0024_persona_share_and_transfer"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="echochallenge",
            name="one_active_echo_war_per_user",
        ),
    ]

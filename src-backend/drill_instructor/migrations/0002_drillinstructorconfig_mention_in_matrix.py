from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="mention_in_matrix",
            field=models.BooleanField(
                default=True,
                help_text=(
                    "When on, the instructor pings users in the Matrix room by their MXID "
                    "(if they have set one). When off, messages are plain text only."
                ),
            ),
        ),
    ]

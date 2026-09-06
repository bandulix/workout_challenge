from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0023_one_random_push_per_day"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorpersona",
            name="is_shared",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "When on, teammates can pick this coach for challenges they own."
                ),
            ),
        ),
    ]

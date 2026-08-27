from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0022_one_react_per_user"),
    ]

    operations = [
        migrations.AlterField(
            model_name="drillinstructorconfig",
            name="random_push",
            field=models.BooleanField(
                default=True,
                help_text=(
                    "The instructor pushes the group once per day at a random "
                    "time (waking hours, 07:00-22:00) with a persona-voiced pep "
                    "talk - independent of whether anyone trained."
                ),
            ),
        ),
    ]

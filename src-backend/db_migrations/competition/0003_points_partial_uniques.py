from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("competition", "0002_initial"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="points",
            name="unique_goal_award_workout",
        ),
        migrations.AddConstraint(
            model_name="points",
            constraint=models.UniqueConstraint(
                fields=("goal", "workout"),
                condition=models.Q(("award__isnull", True), ("goal__isnull", False)),
                name="unique_goal_workout",
            ),
        ),
        migrations.AddConstraint(
            model_name="points",
            constraint=models.UniqueConstraint(
                fields=("award", "workout"),
                condition=models.Q(("goal__isnull", True), ("award__isnull", False)),
                name="unique_award_workout",
            ),
        ),
    ]

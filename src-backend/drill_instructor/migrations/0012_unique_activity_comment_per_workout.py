# One workout comment per competition per workout, DB-enforced.
# post_workout_comment has no idempotency guard, so any double enqueue
# (double submit, sync re-import edge cases, broker redelivery) posted
# the same comment twice. The conditional unique constraint makes the
# save itself idempotent even under concurrent tasks.

from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0011_drillinstructormessage_parent_and_more"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="drillinstructormessage",
            constraint=models.UniqueConstraint(
                fields=["config", "workout"],
                condition=Q(kind="activity"),
                name="unique_activity_comment_per_workout",
            ),
        ),
    ]

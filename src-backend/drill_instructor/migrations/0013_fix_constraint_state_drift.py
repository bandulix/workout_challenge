# State-only fix for a migration drift - the DB is NOT touched.
#
# 0012 added `unique_activity_comment_per_workout` as a deliberately
# DB-only guard (post_workout_comment catches the resulting
# IntegrityError to stay idempotent under concurrent tasks - see
# drill_instructor/tasks.py). But a plain AddConstraint also put the
# constraint into the migration *state* while models.py never declared
# it, so every `makemigrations --check` wanted to drop a protection the
# code depends on. SeparateDatabaseAndState removes it from the state
# only; the database keeps enforcing it.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0012_unique_activity_comment_per_workout"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.RemoveConstraint(
                    model_name="drillinstructormessage",
                    name="unique_activity_comment_per_workout",
                ),
            ],
        ),
    ]

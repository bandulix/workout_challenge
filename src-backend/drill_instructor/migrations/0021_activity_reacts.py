# Emoji reactions on activity cards.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0020_echo_war_lock_and_expire"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="DrillInstructorActivityReact",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("emoji", models.CharField(max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "message",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="activity_reacts",
                        to="drill_instructor.drillinstructormessage",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="drill_activity_reacts",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="drillinstructoractivityreact",
            constraint=models.UniqueConstraint(fields=("message", "user", "emoji"), name="one_react_per_emoji"),
        ),
        migrations.AddIndex(
            model_name="drillinstructoractivityreact",
            index=models.Index(fields=["message", "emoji"], name="activity_react_tally"),
        ),
    ]

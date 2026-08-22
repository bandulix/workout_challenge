"""Legend Echoes: living, claimable trophies + beat job.

Schema: LegendEcho, EchoChallenge; extra message kinds; dog-tag slugs
for immortal originators and slayers.

Data: seeds the 21:20 PeriodicTask the DatabaseScheduler needs - the
static beat_schedule dict in celery.py is documentation-only.
"""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def seed_periodic_task(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    tz = getattr(settings, "TIME_ZONE", "UTC")
    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="20",
        hour="21",
        day_of_week="*",
        day_of_month="*",
        month_of_year="*",
        timezone=tz,
    )
    task, created = PeriodicTask.objects.get_or_create(
        name="drill_instructor_echo_windows",
        defaults={
            "task": "drill_instructor.tasks.resolve_echo_windows",
            "crontab": crontab,
            "enabled": True,
            "description": (
                "21:20: close Echo challenge windows that ran out and "
                "immortalize Echoes that survived the competition or "
                "enough failed claims."
            ),
        },
    )
    if not created:
        changed = []
        if task.task != "drill_instructor.tasks.resolve_echo_windows":
            task.task = "drill_instructor.tasks.resolve_echo_windows"
            changed.append("task")
        if task.crontab_id != crontab.id:
            task.crontab = crontab
            changed.append("crontab")
        if not task.enabled:
            task.enabled = True
            changed.append("enabled")
        if changed:
            task.save()


def remove_periodic_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name="drill_instructor_echo_windows").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0018_weekly_coach_vote"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
        ("custom_user", "0001_initial"),
        ("workouts", "0004_workout_health_id"),
    ]

    operations = [
        migrations.AlterField(
            model_name="drillinstructormessage",
            name="kind",
            field=models.CharField(
                choices=[
                    ("activity", "Workout comment"),
                    ("test", "Test message"),
                    ("nudge", "Inactivity nudge"),
                    ("push", "Random group push"),
                    ("reply", "Participant reply"),
                    ("reaction", "Coach reaction"),
                    ("photo", "Participant photo post"),
                    ("order", "Daily order"),
                    ("sigh", "Order failure"),
                    ("dunce", "Dunce crowning"),
                    ("handover", "Weekly coach handover"),
                    ("echo", "Legend Echo minted"),
                    ("claim", "Legend Echo claimed"),
                ],
                default="activity",
                help_text="What triggered this message (a workout, a test, a quiet-day nudge, a random group push, a participant reply, or the coach's reaction to one).",
                max_length=12,
            ),
        ),
        migrations.AlterField(
            model_name="dogtag",
            name="slug",
            field=models.CharField(
                choices=[
                    ("first_blood", "First Blood"),
                    ("ghost_killer", "Ghost Killer"),
                    ("photogenic", "Photogenic"),
                    ("never_missed_monday", "Never Missed Monday"),
                    ("survived_the_dunce", "Survived the Dunce"),
                    ("echo_immortal", "Echo Immortal"),
                    ("echo_slayer", "Echo Slayer"),
                ],
                max_length=32,
            ),
        ),
        migrations.CreateModel(
            name="LegendEcho",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=80)),
                ("narrative", models.TextField()),
                ("power", models.PositiveSmallIntegerField(default=1)),
                ("metric", models.CharField(
                    choices=[("duration", "Minutes"), ("distance", "Kilometres")],
                    default="duration",
                    max_length=12,
                )),
                ("metric_value", models.FloatField()),
                ("sport_type", models.CharField(max_length=40)),
                ("image", models.ImageField(blank=True, null=True, upload_to="echo_pics/")),
                ("chain_length", models.PositiveIntegerField(default=1)),
                ("defenses", models.PositiveIntegerField(default=0)),
                ("status", models.CharField(
                    choices=[
                        ("undefeated", "Undefeated"),
                        ("contested", "Contested"),
                        ("immortal", "Immortal"),
                        ("retired", "Retired"),
                    ],
                    default="undefeated",
                    max_length=12,
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_claimed_at", models.DateTimeField(blank=True, null=True)),
                ("immortalized_at", models.DateTimeField(blank=True, null=True)),
                ("config", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="echoes",
                    to="drill_instructor.drillinstructorconfig",
                )),
                ("holder", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="echoes_held",
                    to="custom_user.customuser",
                )),
                ("holder_workout", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="echoes_held",
                    to="workouts.workout",
                )),
                ("origin_user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="echoes_originated",
                    to="custom_user.customuser",
                )),
                ("origin_workout", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="echoes_originated",
                    to="workouts.workout",
                )),
            ],
            options={"ordering": ["-power", "-created_at"]},
        ),
        migrations.AddIndex(
            model_name="legendecho",
            index=models.Index(fields=["config", "status"], name="echo_config_status"),
        ),
        migrations.AddConstraint(
            model_name="legendecho",
            constraint=models.UniqueConstraint(
                condition=models.Q(origin_workout__isnull=False),
                fields=("config", "origin_workout"),
                name="one_echo_per_origin_workout",
            ),
        ),
        migrations.CreateModel(
            name="EchoChallenge",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("committed_at", models.DateTimeField(auto_now_add=True)),
                ("window_end", models.DateTimeField()),
                ("status", models.CharField(
                    choices=[
                        ("active", "Active"),
                        ("won", "Won"),
                        ("lost", "Lost"),
                        ("expired", "Expired"),
                    ],
                    default="active",
                    max_length=12,
                )),
                ("challenger", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="echo_challenges",
                    to="custom_user.customuser",
                )),
                ("echo", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="challenges",
                    to="drill_instructor.legendecho",
                )),
                ("resolving_workout", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="echo_resolves",
                    to="workouts.workout",
                )),
            ],
            options={"ordering": ["-committed_at"]},
        ),
        migrations.AddIndex(
            model_name="echochallenge",
            index=models.Index(fields=["status", "window_end"], name="echo_chal_status_end"),
        ),
        migrations.AddConstraint(
            model_name="echochallenge",
            constraint=models.UniqueConstraint(
                condition=models.Q(status="active"),
                fields=("echo",),
                name="one_active_challenge_per_echo",
            ),
        ),
        migrations.RunPython(seed_periodic_task, remove_periodic_task),
    ]

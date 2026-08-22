"""Coach arcade: daily orders, dunce crown, dog tags + beat jobs.

Schema: DailyOrder, DogTag, dunce fields on config, extra message kinds.

Data: seeds the PeriodicTask rows the DatabaseScheduler needs - the
static beat_schedule dict in celery.py is documentation-only.
"""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


def seed_periodic_tasks(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    tz = getattr(settings, "TIME_ZONE", "UTC")

    jobs = [
        {
            "name": "drill_instructor_daily_order",
            "task": "drill_instructor.tasks.issue_daily_orders",
            "minute": "5",
            "hour": "7",
            "description": "07:05: issue the coach's sealed Order of the Day in every running coached challenge.",
        },
        {
            "name": "drill_instructor_close_order",
            "task": "drill_instructor.tasks.close_daily_orders",
            "minute": "5",
            "hour": "22",
            "description": "22:05: public sigh at anyone who ignored today's order.",
        },
        {
            "name": "drill_instructor_assign_dunce",
            "task": "drill_instructor.tasks.assign_dunces",
            "minute": "10",
            "hour": "0",
            "description": "00:10: last on the board wears the megaphone until they log.",
        },
    ]
    for job in jobs:
        crontab, _ = CrontabSchedule.objects.get_or_create(
            minute=job["minute"],
            hour=job["hour"],
            day_of_week="*",
            day_of_month="*",
            month_of_year="*",
            timezone=tz,
        )
        task, created = PeriodicTask.objects.get_or_create(
            name=job["name"],
            defaults={
                "task": job["task"],
                "crontab": crontab,
                "enabled": True,
                "description": job["description"],
            },
        )
        if not created:
            changed = []
            if task.task != job["task"]:
                task.task = job["task"]
                changed.append("task")
            if task.crontab_id != crontab.id:
                task.crontab = crontab
                changed.append("crontab")
            if changed:
                task.save()


def remove_periodic_tasks(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(
        name__in=[
            "drill_instructor_daily_order",
            "drill_instructor_close_order",
            "drill_instructor_assign_dunce",
        ]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0016_message_persona_snapshot"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
        ("custom_user", "0008_customuser_health_linkage"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="dunce",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="drill_dunce_crowns",
                to="custom_user.customuser",
            ),
        ),
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="dunce_since",
            field=models.DateTimeField(blank=True, null=True),
        ),
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
                ],
                default="activity",
                help_text="What triggered this message (a workout, a test, a quiet-day nudge, a random group push, a participant reply, or the coach's reaction to one).",
                max_length=12,
            ),
        ),
        migrations.CreateModel(
            name="DailyOrder",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("kind", models.CharField(
                    choices=[
                        ("log_one", "Log any workout"),
                        ("min_minutes", "Hit a minutes target"),
                        ("beat_rival", "Beat a rival's minutes"),
                        ("photo_proof", "Post photo proof"),
                    ],
                    max_length=16,
                )),
                ("spec", models.JSONField(blank=True, default=dict)),
                ("brief", models.CharField(max_length=280)),
                ("failed_announced", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("completed_by", models.ManyToManyField(
                    blank=True,
                    related_name="completed_daily_orders",
                    to="custom_user.customuser",
                )),
                ("config", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="daily_orders",
                    to="drill_instructor.drillinstructorconfig",
                )),
            ],
            options={"ordering": ["-date"]},
        ),
        migrations.AddConstraint(
            model_name="dailyorder",
            constraint=models.UniqueConstraint(fields=("config", "date"), name="one_order_per_config_day"),
        ),
        migrations.AddIndex(
            model_name="dailyorder",
            index=models.Index(fields=["config", "date"], name="daily_order_config_day"),
        ),
        migrations.CreateModel(
            name="DogTag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.CharField(
                    choices=[
                        ("first_blood", "First Blood"),
                        ("ghost_killer", "Ghost Killer"),
                        ("photogenic", "Photogenic"),
                        ("never_missed_monday", "Never Missed Monday"),
                        ("survived_the_dunce", "Survived the Dunce"),
                    ],
                    max_length=32,
                )),
                ("earned_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="dog_tags",
                    to="custom_user.customuser",
                )),
            ],
            options={"ordering": ["earned_at"]},
        ),
        migrations.AddConstraint(
            model_name="dogtag",
            constraint=models.UniqueConstraint(fields=("user", "slug"), name="one_dog_tag_per_user"),
        ),
        migrations.RunPython(seed_periodic_tasks, remove_periodic_tasks),
    ]

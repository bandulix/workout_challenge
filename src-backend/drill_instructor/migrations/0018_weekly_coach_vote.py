"""Weekly group vote for next week's Drill Instructor.

Schema: DrillInstructorPersonaVote, previous_persona + persona_changed_at
on config, handover message kind.

Data: seeds the Monday 07:15 PeriodicTask for DatabaseScheduler.
"""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def seed_periodic_task(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    tz = getattr(settings, "TIME_ZONE", "UTC")
    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute="15",
        hour="7",
        day_of_week="1",
        day_of_month="*",
        month_of_year="*",
        timezone=tz,
    )
    task, created = PeriodicTask.objects.get_or_create(
        name="drill_instructor_weekly_coach_vote",
        defaults={
            "task": "drill_instructor.tasks.apply_weekly_persona_votes",
            "crontab": crontab,
            "enabled": True,
            "description": (
                "Monday 07:15: seat the voted Drill Instructor in every "
                "running coached challenge and reset the ballot."
            ),
        },
    )
    if not created:
        changed = []
        if task.task != "drill_instructor.tasks.apply_weekly_persona_votes":
            task.task = "drill_instructor.tasks.apply_weekly_persona_votes"
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
    PeriodicTask.objects.filter(name="drill_instructor_weekly_coach_vote").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0017_arcade"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
        ("custom_user", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="persona_changed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="drillinstructorconfig",
            name="previous_persona",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="drill_instructor.drillinstructorpersona",
            ),
        ),
        migrations.CreateModel(
            name="DrillInstructorPersonaVote",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "config",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="persona_votes",
                        to="drill_instructor.drillinstructorconfig",
                    ),
                ),
                (
                    "persona",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="challenge_votes",
                        to="drill_instructor.drillinstructorpersona",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="drill_persona_votes",
                        to="custom_user.customuser",
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="drillinstructorpersonavote",
            constraint=models.UniqueConstraint(
                fields=("config", "user"),
                name="one_persona_vote_per_user",
            ),
        ),
        migrations.AddIndex(
            model_name="drillinstructorpersonavote",
            index=models.Index(fields=["config", "persona"], name="persona_vote_tally"),
        ),
        migrations.RunPython(seed_periodic_task, remove_periodic_task),
    ]

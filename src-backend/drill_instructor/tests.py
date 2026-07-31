import datetime
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from competition.models import Competition
from custom_user.models import CustomUser
from workouts.models import Workout

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona
from .tasks import post_inactivity_nudges


def _user(email, first_name):
    return CustomUser.objects.create_user(
        email=email,
        password="test-pw",
        first_name=first_name,
        last_name="",
    )


class PostInactivityNudgesTests(TestCase):
    """The quiet-day sweep: one persona-voiced nudge per running
    competition that saw zero workouts today."""

    def setUp(self):
        # Model saves trigger point-recalc / welcome-email / coach-comment
        # plumbing that expects a Celery broker - replace all of it with
        # no-ops so the test runs without one.
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        llm_patcher = mock.patch(
            "drill_instructor.tasks.generate_message",
            return_value="Wake up, platoon!",
        )
        self.addCleanup(llm_patcher.stop)
        self.generate_message = llm_patcher.start()

        self.persona = DrillInstructorPersona.objects.create(
            name="Test Sergeant",
            system_prompt="You are a test sergeant.",
        )
        self.owner = _user("owner@example.com", "Olivia")
        self.athlete = _user("athlete@example.com", "Alex")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Morning Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=self.persona,
            nudge_on_inactivity=True,
        )

    def _workout_today(self, user):
        return Workout.objects.create(
            user=user,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )

    def test_posts_nudge_on_quiet_day(self):
        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 1)
        message = DrillInstructorMessage.objects.get(config=self.config)
        self.assertEqual(message.kind, DrillInstructorMessage.KIND_NUDGE)
        self.assertIsNone(message.workout)
        self.assertEqual(message.body, "Wake up, platoon!")
        self.assertTrue(message.success)

        self.config.refresh_from_db()
        self.assertEqual(self.config.messages_posted, 1)
        self.assertIsNotNone(self.config.last_posted_at)

    def test_prompt_addresses_the_group(self):
        post_inactivity_nudges()

        _, kwargs = self.generate_message.call_args
        prompt = kwargs["user_prompt"]
        self.assertIn("Morning Cup", prompt)
        self.assertIn("NOT A SINGLE participant", prompt)
        self.assertIn("@Alex", prompt)

    def test_skips_when_workout_logged_today(self):
        self._workout_today(self.athlete)

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_second_run_same_day_is_idempotent(self):
        post_inactivity_nudges()
        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 1)

    def test_skips_when_toggle_disabled(self):
        self.config.nudge_on_inactivity = False
        self.config.save()

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_skips_when_instructor_disabled(self):
        self.config.enabled = False
        self.config.save()

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_skips_when_competition_not_running(self):
        today = timezone.localdate()
        self.competition.start_date = today + datetime.timedelta(days=2)
        self.competition.end_date = today + datetime.timedelta(days=9)
        self.competition.save()

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_fallback_body_when_llm_unavailable(self):
        self.generate_message.return_value = None

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 1)
        message = DrillInstructorMessage.objects.get(config=self.config)
        self.assertIn("Morning Cup", message.body)
        self.assertIn("Test Sergeant", message.body)


class InactivityNudgePeriodicTaskTests(TestCase):
    """Migration 0007 seeds the PeriodicTask row the DatabaseScheduler
    needs - without it the celery.py beat entry alone would never fire."""

    def test_periodic_task_seeded(self):
        from django_celery_beat.models import PeriodicTask

        task = PeriodicTask.objects.get(name="drill_instructor_inactivity_nudge")
        self.assertEqual(task.task, "drill_instructor.tasks.post_inactivity_nudges")
        self.assertTrue(task.enabled)
        self.assertEqual(task.crontab.hour, "17")
        self.assertEqual(task.crontab.minute, "10")

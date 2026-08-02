import datetime
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from competition.models import Competition
from custom_user.models import CustomUser
from workouts.models import Workout

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona
from .tasks import _draw_push_plan, post_inactivity_nudges, post_random_pushes


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
            return_value=("Wake up, platoon!", None),
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
        self.generate_message.return_value = (None, "no LLM API key configured")

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 1)
        message = DrillInstructorMessage.objects.get(config=self.config)
        self.assertIn("Morning Cup", message.body)
        self.assertIn("Test Sergeant", message.body)


class PostRandomPushesTests(TestCase):
    """The random daily group push: 1-2 persona-voiced pep talks per day
    at drawn random times, independent of activity."""

    def setUp(self):
        # Same plumbing stubs as the nudge tests: no Celery broker needed.
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
            return_value=("Push harder, team!", None),
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
            random_push=True,
        )

    def test_posts_when_slot_due_and_is_idempotent(self):
        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["00:00"]):
            result = post_random_pushes()

            self.assertEqual(result["posted"], 1)
            message = DrillInstructorMessage.objects.get(config=self.config)
            self.assertEqual(message.kind, DrillInstructorMessage.KIND_PUSH)
            self.assertIsNone(message.workout)
            self.assertEqual(message.body, "Push harder, team!")
            self.assertTrue(message.success)

            self.config.refresh_from_db()
            self.assertEqual(self.config.push_plan, ["00:00"])
            self.assertEqual(self.config.push_plan_date, timezone.localdate())
            self.assertEqual(self.config.messages_posted, 1)

            # Re-running later the same day must not re-post the slot.
            result = post_random_pushes()
            self.assertEqual(result["posted"], 0)
            self.assertEqual(DrillInstructorMessage.objects.count(), 1)

    def test_posts_nothing_before_slot(self):
        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["23:59"]):
            result = post_random_pushes()

            self.assertEqual(result["posted"], 0)
            self.assertEqual(DrillInstructorMessage.objects.count(), 0)
            # ...but today's plan was drawn once and is kept.
            self.config.refresh_from_db()
            self.assertEqual(self.config.push_plan, ["23:59"])

    def test_max_two_per_day(self):
        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["00:00", "00:01"]):
            result = post_random_pushes()
            self.assertEqual(result["posted"], 2)

            # Even with both slots due, a re-run stays under the hard cap.
            result = post_random_pushes()
            self.assertEqual(result["posted"], 0)
            self.assertEqual(DrillInstructorMessage.objects.count(), 2)

    def test_skips_when_toggle_disabled(self):
        self.config.random_push = False
        self.config.save()

        result = post_random_pushes()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_skips_when_instructor_disabled(self):
        self.config.enabled = False
        self.config.save()

        result = post_random_pushes()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_skips_when_competition_not_running(self):
        today = timezone.localdate()
        self.competition.start_date = today + datetime.timedelta(days=2)
        self.competition.end_date = today + datetime.timedelta(days=9)
        self.competition.save()

        result = post_random_pushes()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_fallback_body_when_llm_unavailable(self):
        self.generate_message.return_value = (None, "outage")

        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["00:00"]):
            result = post_random_pushes()

            self.assertEqual(result["posted"], 1)
            message = DrillInstructorMessage.objects.get(config=self.config)
            self.assertIn("Morning Cup", message.body)
            self.assertIn("Test Sergeant", message.body)
            self.config.refresh_from_db()
            self.assertEqual(self.config.last_error, "outage")


class DrawPushPlanTests(TestCase):
    """The random slot draw itself: the min-1/max-2 guarantee and the
    waking-hours window hold for every possible roll."""

    def test_always_at_least_one_slot_max_two(self):
        for _ in range(200):
            plan = _draw_push_plan()
            self.assertGreaterEqual(len(plan), 1)
            self.assertLessEqual(len(plan), 2)

    def test_slots_within_waking_hours_and_sorted(self):
        for _ in range(200):
            plan = _draw_push_plan()
            self.assertEqual(plan, sorted(plan))
            for slot in plan:
                self.assertRegex(slot, r"^\d{2}:\d{2}$")
                self.assertGreaterEqual(int(slot[:2]), 7)
                self.assertLess(int(slot[:2]), 22)

    def test_two_slots_kept_apart(self):
        for _ in range(200):
            plan = _draw_push_plan()
            if len(plan) == 2:
                first = int(plan[0][:2]) * 60 + int(plan[0][3:])
                second = int(plan[1][:2]) * 60 + int(plan[1][3:])
                self.assertGreaterEqual(second - first, 90)


class RandomPushPeriodicTaskTests(TestCase):
    """Migration 0009 seeds the PeriodicTask row the DatabaseScheduler
    needs - without it the celery.py beat entry alone would never fire."""

    def test_periodic_task_seeded(self):
        from django_celery_beat.models import PeriodicTask

        task = PeriodicTask.objects.get(name="drill_instructor_random_push")
        self.assertEqual(task.task, "drill_instructor.tasks.post_random_pushes")
        self.assertTrue(task.enabled)
        self.assertEqual(task.crontab.minute, "*/30")


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

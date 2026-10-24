"""Personal orders stay recovery on a red day, and the listen bonus stays off."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from competition.models import Award, Competition, Points
from custom_user.models import CustomUser
from drill_instructor.models import DrillInstructorConfig, DrillInstructorPersona
from readiness.models import AthleteOrder, ChallengeReadinessSetting
from readiness.orders import (
    RED_BRIEF,
    on_workout_logged,
    prescribe,
    safe_voice,
    workout_satisfies,
)
from workouts.models import Workout


class PrescribeTests(TestCase):
    def test_red_is_recovery_and_not_an_all_out(self):
        plan = prescribe("red")
        self.assertEqual(plan["kind"], "recovery")
        self.assertLessEqual(plan["spec"]["max_intensity"], 2)
        self.assertIn("Protect the streak", plan["brief"])
        self.assertEqual(safe_voice("red", "Go all-out and bury yourself.", RED_BRIEF), RED_BRIEF)
        self.assertIn("Protect the streak", safe_voice("red", "Easy day. Protect the streak with a walk.", RED_BRIEF))

    def test_green_and_amber_briefs(self):
        self.assertEqual(prescribe("amber")["kind"], "moderate")
        pushed = prescribe("green", typical_minutes=40)
        self.assertEqual(pushed["kind"], "push")
        self.assertEqual(pushed["spec"]["minutes"], 48)


class SatisfactionTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user(
            "athlete@example.com", "password", first_name="Ada",
        )
        owner = CustomUser.objects.create_user(
            "owner@example.com", "password", first_name="Owner",
        )
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=owner,
            name="Readiness Cup",
            start_date=today - timedelta(days=7),
            end_date=today + timedelta(days=7),
            join_code="READINESS1",
        )
        persona = DrillInstructorPersona.objects.create(
            name="Test Sergeant",
            system_prompt="Be brief.",
        )
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=persona,
        )

    def _order(self, **kwargs):
        defaults = dict(
            user=self.user,
            config=self.config,
            date=timezone.localdate(),
            kind="recovery",
            spec={"min_minutes": 10, "max_intensity": 2, "sports": ["Walk", "Yoga"]},
            brief=RED_BRIEF,
            band="red",
        )
        defaults.update(kwargs)
        return AthleteOrder.objects.create(**defaults)

    def _workout(self, sport="Walk", minutes=20, intensity=1):
        workout = Workout(
            user=self.user,
            sport_type=sport,
            start_datetime=timezone.now(),
            duration=timedelta(minutes=minutes),
            intensity_category=intensity,
        )
        workout.save(score=False)
        return workout

    def test_recovery_accepts_a_walk_and_refuses_all_out(self):
        order = self._order()
        easy = self._workout()
        hard = self._workout(sport="Run", minutes=40, intensity=4)
        self.assertTrue(workout_satisfies(order, easy))
        self.assertFalse(workout_satisfies(order, hard))

    def test_bonus_stays_off_until_the_owner_enables_it(self):
        order = self._order()
        workout = self._workout()
        self.assertEqual(on_workout_logged(workout), 1)
        order.refresh_from_db()
        self.assertTrue(order.completed)
        names = set(Award.objects.filter(competition=self.competition).values_list("name", flat=True))
        self.assertIn("Order", names)
        self.assertNotIn("Listened", names)
        self.assertEqual(Points.objects.filter(workout=workout).count(), 1)

        ChallengeReadinessSetting.objects.create(
            competition=self.competition,
            listen_bonus_enabled=True,
            listen_bonus_points=3,
        )
        order.completed = False
        order.workout = None
        order.save(update_fields=["completed", "workout"])
        second = self._workout(sport="Yoga", minutes=15, intensity=1)
        self.assertEqual(on_workout_logged(second), 1)
        listened = Points.objects.filter(workout=second, award__name="Listened").first()
        self.assertIsNotNone(listened)
        self.assertEqual(int(listened.points_capped), 3)
        order_points = Points.objects.filter(workout=second, award__name="Order").first()
        self.assertEqual(int(order_points.points_capped), 5)

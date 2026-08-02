import datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from custom_user.models import CustomUser, RecalcRequest
from custom_user.point_recalc import bump_stats_generation, recalc_points
from workouts.models import Workout

from .models import ActivityGoal, Competition


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class StatsCacheTests(TestCase):
    """The stats endpoint caches its snapshot per competition+generation.
    A generation bump (workout logged/changed/deleted, capped-points
    recalc finished) makes the next request recompute, so the challenge
    page never shows a stale leaderboard after a change."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self.client = APIClient()
        self.owner = CustomUser.objects.create_user(
            email="owner@example.com", password="test-pw", first_name="Olivia", last_name="",
        )
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Cache Cup",
            start_date=today - datetime.timedelta(days=1),
            end_date=today + datetime.timedelta(days=7),
        )
        self.owner.my_competitions.add(self.competition)

    def _generation(self):
        return cache.get(f"stats-generation:{self.competition.id}", 0)

    def test_snapshot_cached_until_generation_bump(self):
        with mock.patch(
            "competition.views.get_competition_stats",
            side_effect=[{"snap": 1}, {"snap": 2}],
        ) as stats_mock:
            self.client.force_authenticate(self.owner)

            response1 = self.client.get(f"/api/stats/{self.competition.id}/")
            response2 = self.client.get(f"/api/stats/{self.competition.id}/")
            self.assertEqual(response1.json(), {"snap": 1})
            self.assertEqual(response2.json(), {"snap": 1})
            self.assertEqual(stats_mock.call_count, 1)

            bump_stats_generation([self.competition.id])

            response3 = self.client.get(f"/api/stats/{self.competition.id}/")
            self.assertEqual(response3.json(), {"snap": 2})
            self.assertEqual(stats_mock.call_count, 2)

    def test_workout_save_busts_stats_cache(self):
        before = self._generation()

        Workout.objects.create(
            user=self.owner,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )

        self.assertGreater(self._generation(), before)

    def test_workout_delete_busts_stats_cache(self):
        workout = Workout.objects.create(
            user=self.owner,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )
        before = self._generation()

        workout.delete()

        self.assertGreater(self._generation(), before)

    def test_recalc_points_busts_stats_cache(self):
        goal = ActivityGoal.objects.create(
            competition=self.competition, name="Minutes", metric="min", goal=30,
        )
        RecalcRequest(user=self.owner, goal=goal, start_datetime=timezone.now()).save()
        before = self._generation()

        with mock.patch("custom_user.point_recalc.is_task_already_executing", return_value=False):
            recalc_points()

        self.assertGreater(self._generation(), before)

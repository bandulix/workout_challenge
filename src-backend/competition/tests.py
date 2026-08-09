import datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from custom_user.models import CustomUser, RecalcRequest
from custom_user.point_recalc import bump_stats_generation, recalc_points
from workouts.models import Workout

from .models import ActivityGoal, Competition, Points


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

    def test_noop_workout_save_does_not_bust_stats_cache(self):
        """Hourly syncs re-save every known activity; a save that changes
        nothing must not invalidate every challenge snapshot."""
        workout = Workout.objects.create(
            user=self.owner,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )
        before = self._generation()

        workout.save()  # no field changed

        self.assertEqual(self._generation(), before)

    def test_feed_is_cached_until_generation_bump(self):
        """The feed rescans the competition's Points twice per request -
        it is cached per generation like the stats snapshot."""
        workout = Workout.objects.create(
            user=self.owner,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )
        goal = self.competition.activitygoal_set.get(metric="min")
        self.client.force_authenticate(self.owner)

        response1 = self.client.get(f"/api/feed/{self.competition.id}/")
        self.assertEqual(response1.status_code, 200)
        rows1 = response1.json()
        self.assertEqual(len(rows1), 1)

        # A new points row WITHOUT a generation bump (Points.objects.create
        # fires no triggers) must NOT show up while the cache is warm...
        Points.objects.create(goal=goal, workout=workout, points_raw=5, points_capped=5)
        response2 = self.client.get(f"/api/feed/{self.competition.id}/")
        self.assertEqual(response2.json(), rows1)

        # ...and must show up right after the bump. (The competition's
        # second default goal 'Move'/kcal also matched the Run workout.)
        bump_stats_generation([self.competition.id])
        response3 = self.client.get(f"/api/feed/{self.competition.id}/")
        details = response3.json()[0]["details"]
        self.assertEqual(len(details), 3)
        self.assertTrue(any(d["points_capped"] == 5 for d in details))

    def test_feed_cache_never_crosses_the_membership_check(self):
        """The cached feed is only served AFTER the participant check."""
        Workout.objects.create(
            user=self.owner,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )
        self.client.force_authenticate(self.owner)
        response = self.client.get(f"/api/feed/{self.competition.id}/")
        self.assertEqual(response.status_code, 200)  # cache now warm

        stranger = CustomUser.objects.create_user(
            email="stranger@example.com", password="test-pw", first_name="Stan", last_name="",
        )
        self.client.force_authenticate(stranger)
        response = self.client.get(f"/api/feed/{self.competition.id}/")
        self.assertEqual(response.status_code, 403)

    def test_recalc_points_caps_and_deletes_requests(self):
        """The capped-points task: caps applied, rows updated in bulk,
        and exactly the snapshotted requests are drained."""
        goal = ActivityGoal.objects.create(
            competition=self.competition, name="Capped Minutes", metric="min",
            goal=60, period="day", max_per_day=30,
        )
        workout = Workout.objects.create(
            user=self.owner,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=45),  # 75 raw pts, day cap 50
            intensity_category=2,
        )
        row = Points.objects.get(goal=goal, workout=workout)

        with mock.patch("custom_user.point_recalc.is_task_already_executing", return_value=False):
            recalc_points()

        row.refresh_from_db()
        # 45 min of a 60-min goal = 75 raw; capped at 30/60*100 = 50.
        self.assertEqual(float(row.points_raw), 75.0)
        self.assertEqual(float(row.points_capped), 50.0)
        self.assertFalse(RecalcRequest.objects.filter(done=False).exists())

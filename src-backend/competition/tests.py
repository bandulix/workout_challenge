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
        self.assertIn("workout__user__profile_picture", rows1[0])

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


class _Dummy:
    """Stand-in for Goal / Workout / Points in the pure cap-math tests.

    The Scorer only reads a handful of attributes; it does not touch the
    database. Defaults match ActivityGoal's nullable min/max fields.
    """

    def __init__(self, **kwargs):
        self.min_per_workout = None
        self.max_per_workout = None
        self.min_per_day = None
        self.max_per_day = None
        self.min_per_week = None
        self.max_per_week = None
        for key, value in kwargs.items():
            setattr(self, key, value)


class ScorerCapMathTests(TestCase):
    """Table-driven floor/cap math. These cases used to live as a
    ``__main__`` script at the bottom of ``point_recalc.py`` and were
    never run by ``manage.py test`` (or CI)."""

    CASES = (
        ({'goal': 100, 'min_per_workout': 10}, [10], 0),
        ({'goal': 100, 'min_per_workout': 10}, [20], 10),
        ({'goal': 100, 'max_per_workout': 30}, [30], 30),
        ({'goal': 100, 'max_per_workout': 30}, [40], 30),
        ({'goal': 100, 'min_per_workout': 10, 'max_per_workout': 30}, [40], 20),
        ({'goal': 100, 'min_per_day': 10}, [10], 0),
        ({'goal': 100, 'min_per_day': 10}, [20], 10),
        ({'goal': 100, 'min_per_day': 10}, [8, 8], 6),
        ({'goal': 100, 'max_per_day': 30}, [20], 20),
        ({'goal': 100, 'max_per_day': 30}, [20, 20], 30),
        ({'goal': 100, 'min_per_day': 10, 'max_per_day': 30}, [8, 12, 8, 8, 14], 20),
        ({'goal': 100, 'min_per_week': 10}, [10], 0),
        ({'goal': 100, 'min_per_week': 10}, [20], 10),
        ({'goal': 100, 'max_per_week': 30}, [20], 20),
        ({'goal': 100, 'max_per_week': 30}, [20, 20], 30),
        ({'goal': 100, 'min_per_week': 10, 'max_per_week': 30}, [8, 12, 8, 8, 14], 20),
        ({'goal': 100, 'min_per_workout': 10, 'min_per_day': 20}, [5, 20, 5, 20], 15),
        ({'goal': 100, 'min_per_workout': 20, 'min_per_day': 10}, [5, 30, 30], 20),
        ({'goal': 100, 'max_per_workout': 20, 'max_per_day': 30}, [20, 25, 25, 25], 30),
        ({'goal': 100, 'max_per_workout': 30, 'max_per_day': 20}, [20, 25, 25, 25], 20),
        ({'goal': 100, 'min_per_workout': 10, 'max_per_day': 15}, [5, 5, 5, 5], 0),
        ({'goal': 100, 'min_per_workout': 10, 'max_per_day': 30}, [15, 35, 5, 15], 30),
    )

    def test_floors_and_caps(self):
        from custom_user.point_recalc import Scorer

        workout = _Dummy(start_datetime=datetime.datetime.fromisoformat('2023-01-01T00:00:00'))
        for goal_kwargs, points, expected in self.CASES:
            with self.subTest(goal=goal_kwargs, points=points):
                scorer = Scorer()
                scorer.set_goal(_Dummy(**goal_kwargs))
                earned = 0
                for raw in points:
                    earned += scorer.calculate_points(_Dummy(points_raw=raw, workout=workout))
                self.assertEqual(earned, expected)

    @override_settings(TIME_ZONE="Europe/Berlin")
    def test_buckets_use_local_date_not_utc(self):
        from custom_user.point_recalc import Scorer

        timezone.activate("Europe/Berlin")
        self.addCleanup(timezone.deactivate)
        scorer = Scorer()
        scorer.set_goal(_Dummy(goal=150, max_per_day=60))
        utc = datetime.timezone.utc
        morning = _Dummy(start_datetime=datetime.datetime(2026, 8, 21, 10, 0, tzinfo=utc))
        late = _Dummy(start_datetime=datetime.datetime(2026, 8, 21, 23, 30, tzinfo=utc))
        first = scorer.calculate_points(_Dummy(points_raw=30, workout=morning))
        second = scorer.calculate_points(_Dummy(points_raw=30, workout=late))
        self.assertEqual(first, 30)
        # UTC date is 21 Aug for both; Berlin local dates are 21 and 22.
        self.assertEqual(second, 30)

    def test_week_bucket_includes_iso_year(self):
        from custom_user.point_recalc import Scorer

        scorer = Scorer()
        scorer.set_goal(_Dummy(goal=100, max_per_week=30))
        utc = datetime.timezone.utc
        # Monday 2024-12-30 is ISO week 1 of 2025; 2026-01-01 is week 1 of 2026.
        week1_2025 = _Dummy(start_datetime=datetime.datetime(2024, 12, 30, 12, 0, tzinfo=utc))
        week1_2026 = _Dummy(start_datetime=datetime.datetime(2026, 1, 1, 12, 0, tzinfo=utc))
        first = scorer.calculate_points(_Dummy(points_raw=20, workout=week1_2025))
        second = scorer.calculate_points(_Dummy(points_raw=20, workout=week1_2026))
        self.assertEqual(first, 20)
        self.assertEqual(second, 20)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class CeleryAllowlistTests(TestCase):
    """Staff can enqueue a known operational task, not an arbitrary name."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        self.client = APIClient()
        self.admin = CustomUser.objects.create_user(
            email="celery-admin@example.com", password="test-pw",
            first_name="Cel", last_name="", is_staff=True, is_superuser=True,
        )

    def test_unknown_task_is_forbidden(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/celery/?task=os.system")
        self.assertEqual(response.status_code, 403)

    def test_list_only_returns_allowlisted_names(self):
        from .views import CeleryQueryView
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/celery/tasks/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), set(CeleryQueryView.ALLOWED_TASKS))

    def test_failed_task_status_does_not_echo_exception(self):
        self.client.force_authenticate(self.admin)
        failed = mock.Mock()
        failed.id = "abc"
        failed.status = "FAILURE"
        failed.successful.return_value = False
        failed.failed.return_value = True
        failed.result = RuntimeError("/opt/secret/broker redis://:hunter2@localhost")
        with mock.patch("competition.views.current_app.AsyncResult", return_value=failed):
            response = self.client.get("/api/celery/tasks/abc/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["error"], "Task failed.")
        self.assertNotIn("hunter2", str(body))
        self.assertNotIn("/opt/secret", str(body))


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class GoalCompetitionImmutableTests(TestCase):
    """An owner must not re-parent a goal onto someone else's challenge."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        self.client = APIClient()
        today = timezone.localdate()
        self.alice = CustomUser.objects.create_user(
            email="alice-goal@example.com", password="test-pw", first_name="Alice", last_name="",
        )
        self.bob = CustomUser.objects.create_user(
            email="bob-goal@example.com", password="test-pw", first_name="Bob", last_name="",
        )
        self.a_cup = Competition.objects.create(
            owner=self.alice, name="Alice Cup",
            start_date=today, end_date=today + datetime.timedelta(days=7),
        )
        self.b_cup = Competition.objects.create(
            owner=self.bob, name="Bob Cup",
            start_date=today, end_date=today + datetime.timedelta(days=7),
        )
        self.goal = self.a_cup.activitygoal_set.first()

    def test_patch_cannot_move_goal_to_another_competition(self):
        self.client.force_authenticate(self.alice)
        response = self.client.patch(
            f"/api/goal/{self.goal.id}/",
            {"competition": self.b_cup.id, "name": "Still Alice's"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.goal.refresh_from_db()
        self.assertEqual(self.goal.competition_id, self.a_cup.id)
        self.assertEqual(self.goal.name, "Still Alice's")


class LeaderboardAthleteCardTests(TestCase):
    """Public card fields on the stats leaderboard - no email or legal name."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        self.alice = CustomUser.objects.create_user(
            email="alice-card@example.com", password="test-pw",
            first_name="Alice", last_name="Secret",
        )
        today = timezone.localdate()
        self.cup = Competition.objects.create(
            owner=self.alice, name="Card Cup",
            start_date=today - datetime.timedelta(days=2),
            end_date=today + datetime.timedelta(days=5),
        )
        self.alice.my_competitions.add(self.cup)
        w = Workout(
            user=self.alice, sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=40),
            intensity_category=2,
        )
        w.save(score=False)
        goal = self.cup.activitygoal_set.first()
        Points.objects.create(goal=goal, workout=w, points_raw=40, points_capped=40)
        from drill_instructor.models import DogTag
        DogTag.objects.create(user=self.alice, slug=DogTag.SLUG_FIRST_BLOOD)

    def test_leaderboard_card_is_public_only(self):
        from .stats import get_competition_stats
        snap = get_competition_stats(self.cup.id)
        row = snap["leaderboard"]["individual"][0]
        self.assertEqual(row["username"], self.alice.username)
        self.assertNotIn("email", row)
        self.assertNotIn("first_name", row)
        self.assertNotIn("last_name", row)
        self.assertEqual(row["workouts"], 1)
        self.assertGreaterEqual(row["active_days"], 1)
        self.assertGreaterEqual(row["streak"], 1)
        slugs = [t["slug"] for t in row["dog_tags"]]
        self.assertIn("first_blood", slugs)
        self.assertEqual(row["echoes_held"], 0)
        self.assertEqual(float(row["scaling_kcal"]), 1.0)
        self.assertEqual(float(row["scaling_distance"]), 1.0)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class GoalEditRescoresChallengeTests(TestCase):
    """Changing a goal's target/metric recomputes points_raw for every
    workout in the challenge; cap-only edits still recap from day 1."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        today = timezone.localdate()
        self.owner = CustomUser.objects.create_user(
            email="goal-owner@example.com", password="test-pw", first_name="Gia", last_name="",
        )
        self.athlete = CustomUser.objects.create_user(
            email="goal-athlete@example.com", password="test-pw", first_name="Pat", last_name="",
        )
        self.competition = Competition.objects.create(
            owner=self.owner, name="Rescore Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.goal = self.competition.activitygoal_set.get(metric="min")
        self.workout = Workout.objects.create(
            user=self.athlete,
            sport_type="Run",
            start_datetime=timezone.now() - datetime.timedelta(days=1),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )
        self.points = Points.objects.get(goal=self.goal, workout=self.workout)

    def test_changing_target_recomputes_raw_points(self):
        # Default Exercise goal is 150 min/week → 30 min = 20 points.
        self.assertAlmostEqual(float(self.points.points_raw), 20.0, places=2)
        RecalcRequest.objects.all().delete()

        self.goal.goal = 300
        self.goal.save()

        self.points.refresh_from_db()
        self.assertAlmostEqual(float(self.points.points_raw), 10.0, places=2)
        request = RecalcRequest.objects.get(user=self.athlete, goal=self.goal)
        self.assertEqual(timezone.localtime(request.start_datetime).date(), self.competition.start_date)

    def test_renaming_a_goal_does_not_touch_points(self):
        original = float(self.points.points_raw)
        RecalcRequest.objects.all().delete()
        self.goal.name = "Cardio minutes"
        self.goal.save()
        self.points.refresh_from_db()
        self.assertAlmostEqual(float(self.points.points_raw), original, places=2)
        self.assertFalse(RecalcRequest.objects.filter(goal=self.goal).exists())

    def test_cap_only_edit_keeps_raw_but_recaps_from_day_one(self):
        original = float(self.points.points_raw)
        RecalcRequest.objects.all().delete()
        self.goal.max_per_day = 20
        self.goal.save()
        self.points.refresh_from_db()
        self.assertAlmostEqual(float(self.points.points_raw), original, places=2)
        request = RecalcRequest.objects.get(user=self.athlete, goal=self.goal)
        self.assertEqual(timezone.localtime(request.start_datetime).date(), self.competition.start_date)

    def test_different_durations_stay_different_after_retarget(self):
        # Regression: a whole-challenge rescore + daily cap must not write
        # the same points onto every activity (30 min vs 40 min both sit
        # under the default 60 min/day cap).
        short = self.workout  # 30 min
        long = Workout.objects.create(
            user=self.athlete,
            sport_type="Run",
            start_datetime=timezone.now() - datetime.timedelta(days=2),
            duration=datetime.timedelta(minutes=40),
            intensity_category=2,
        )
        self.goal.goal = 300
        self.goal.save()
        short_pts = Points.objects.get(goal=self.goal, workout=short)
        long_pts = Points.objects.get(goal=self.goal, workout=long)
        # 30 min / 300 * 100 = 10; 40 min / 300 * 100 = 13.33
        self.assertAlmostEqual(float(short_pts.points_raw), 10.0, places=2)
        self.assertAlmostEqual(float(long_pts.points_raw), 40 / 300 * 100, places=2)
        self.assertAlmostEqual(float(short_pts.points_capped), float(short_pts.points_raw), places=2)
        self.assertAlmostEqual(float(long_pts.points_capped), float(long_pts.points_raw), places=2)
        self.assertNotAlmostEqual(float(short_pts.points_capped), float(long_pts.points_capped), places=2)

    def test_retarget_recaps_immediately_without_celery(self):
        # Default Exercise max_per_day=60 min. A 90 min run at a 150 min
        # weekly goal is 60 raw, capped at 40. Recap must run on save even
        # when Celery is mocked out (production throttle used to skip it).
        long = Workout.objects.create(
            user=self.athlete,
            sport_type="Run",
            start_datetime=timezone.now() - datetime.timedelta(days=2),
            duration=datetime.timedelta(minutes=90),
            intensity_category=2,
        )
        # Touch a cap field so save() is a scoring change; raw stays
        # duration-based, recap_goal runs inline.
        self.goal.max_per_week = 239
        self.goal.save()
        thirty = Points.objects.get(goal=self.goal, workout=self.workout)
        ninety = Points.objects.get(goal=self.goal, workout=long)
        self.assertAlmostEqual(float(thirty.points_raw), 20.0, places=2)
        self.assertAlmostEqual(float(ninety.points_raw), 60.0, places=2)
        # 30 min sits under the 60 min/day cap; 90 min is clipped to it.
        self.assertAlmostEqual(float(thirty.points_capped), 20.0, places=2)
        self.assertAlmostEqual(float(ninety.points_capped), 40.0, places=2)

    def test_flattened_raw_is_repaired_on_retarget(self):
        # Production symptom: every row already holds the same raw score
        # after a bad recap. Changing the target must rewrite from each
        # workout's duration, not leave the flattened value in place.
        long = Workout.objects.create(
            user=self.athlete,
            sport_type="Run",
            start_datetime=timezone.now() - datetime.timedelta(days=2),
            duration=datetime.timedelta(minutes=45),
            intensity_category=2,
        )
        Points.objects.filter(goal=self.goal).update(points_raw=40, points_capped=40)
        self.goal.goal = 300
        self.goal.save()
        short_pts = Points.objects.get(goal=self.goal, workout=self.workout)
        long_pts = Points.objects.get(goal=self.goal, workout=long)
        self.assertAlmostEqual(float(short_pts.points_raw), 10.0, places=2)
        self.assertAlmostEqual(float(long_pts.points_raw), 15.0, places=2)
        self.assertNotAlmostEqual(float(short_pts.points_capped), float(long_pts.points_capped), places=2)

    def test_rescore_repairs_flattened_rows_without_changing_the_goal(self):
        from competition.scorer import rescore_activity_goal

        long = Workout.objects.create(
            user=self.athlete,
            sport_type="Run",
            start_datetime=timezone.now() - datetime.timedelta(days=2),
            duration=datetime.timedelta(minutes=45),
            intensity_category=2,
        )
        Points.objects.filter(goal=self.goal).update(points_raw=40, points_capped=40)
        rescore_activity_goal(self.goal)
        short_pts = Points.objects.get(goal=self.goal, workout=self.workout)
        long_pts = Points.objects.get(goal=self.goal, workout=long)
        self.assertAlmostEqual(float(short_pts.points_raw), 20.0, places=2)
        self.assertAlmostEqual(float(long_pts.points_raw), 30.0, places=2)
        self.assertAlmostEqual(float(short_pts.points_capped), 20.0, places=2)
        self.assertAlmostEqual(float(long_pts.points_capped), 30.0, places=2)

    @override_settings(TIME_ZONE="Europe/Berlin")
    def test_utc_same_day_local_different_days_do_not_share_cap(self):
        # 23:30 UTC is the next calendar morning in Europe/Berlin year-round
        # (CET +1 / CEST +2). A UTC day-bucket recap would share the
        # 40-point daily cap (30 + 10); local buckets keep both at 30.
        timezone.activate("Europe/Berlin")
        self.addCleanup(timezone.deactivate)
        utc = datetime.timezone.utc
        # Three days back so this pair does not share a local calendar
        # day with setUp's now-1-day workout (that 20-point row would
        # eat the 40-point daily cap and clip 30 → 20).
        day = timezone.localdate() - datetime.timedelta(days=3)
        morning = Workout.objects.create(
            user=self.athlete,
            sport_type="Run",
            start_datetime=datetime.datetime.combine(day, datetime.time(10, 0), tzinfo=utc),
            duration=datetime.timedelta(minutes=45),
            intensity_category=2,
        )
        late = Workout.objects.create(
            user=self.athlete,
            sport_type="Run",
            start_datetime=datetime.datetime.combine(day, datetime.time(23, 30), tzinfo=utc),
            duration=datetime.timedelta(minutes=45),
            intensity_category=2,
        )
        self.goal.max_per_week = 239
        self.goal.save()
        morning_pts = Points.objects.get(goal=self.goal, workout=morning)
        late_pts = Points.objects.get(goal=self.goal, workout=late)
        self.assertAlmostEqual(float(morning_pts.points_raw), 30.0, places=2)
        self.assertAlmostEqual(float(late_pts.points_raw), 30.0, places=2)
        self.assertAlmostEqual(float(morning_pts.points_capped), 30.0, places=2)
        self.assertAlmostEqual(float(late_pts.points_capped), 30.0, places=2)

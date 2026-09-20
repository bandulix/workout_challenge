import datetime
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from custom_user.models import CustomUser
from workouts.models import Workout


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class WorkoutApiTests(TestCase):
    """The workout endpoint is the only way points get minted. These
    cover the permission boundary and the duration/steps validators -
    there was no test module for this app at all."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self.client = APIClient()
        self.user = CustomUser.objects.create_user(
            email="athlete@example.com", password="test-pw", first_name="Ali", last_name="",
        )
        self.other = CustomUser.objects.create_user(
            email="other@example.com", password="test-pw", first_name="Oli", last_name="",
        )

    def _payload(self, **overrides):
        body = {
            "sport_type": "Run",
            "start_datetime": timezone.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "duration": "00:30:00",
            "intensity_category": 2,
        }
        body.update(overrides)
        return body

    def test_anonymous_gets_401(self):
        response = self.client.get("/api/workout/")
        self.assertEqual(response.status_code, 401)

    def test_create_and_list_own_workout(self):
        self.client.force_authenticate(self.user)
        created = self.client.post("/api/workout/", self._payload(), format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["sport_type"], "Run")

        listed = self.client.get("/api/workout/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)
        self.assertEqual(listed.json()[0]["id"], created.json()["id"])

    def test_cannot_see_someone_elses_workout(self):
        theirs = Workout.objects.create(
            user=self.other,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=20),
            intensity_category=2,
        )
        self.client.force_authenticate(self.user)
        listed = self.client.get("/api/workout/")
        self.assertEqual(listed.json(), [])
        detail = self.client.get(f"/api/workout/{theirs.pk}/")
        self.assertEqual(detail.status_code, 404)

    def test_cannot_patch_someone_elses_workout(self):
        theirs = Workout.objects.create(
            user=self.other,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=20),
            intensity_category=2,
        )
        self.client.force_authenticate(self.user)
        response = self.client.patch(
            f"/api/workout/{theirs.pk}/",
            {"duration": "00:45:00"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_duration_over_24h_rejected(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            "/api/workout/",
            self._payload(duration="25:00:00"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("duration", response.json())
        self.assertFalse(Workout.objects.filter(user=self.user).exists())

    def test_unrealistic_kcal_and_distance_rejected(self):
        self.client.force_authenticate(self.user)
        too_hot = self.client.post("/api/workout/", self._payload(kcal=50_000), format="json")
        self.assertEqual(too_hot.status_code, 400)
        too_far = self.client.post("/api/workout/", self._payload(distance=999), format="json")
        self.assertEqual(too_far.status_code, 400)

    def test_list_limit_caps_payload(self):
        self.client.force_authenticate(self.user)
        for i in range(3):
            Workout.objects.create(
                user=self.user, sport_type="Run",
                start_datetime=timezone.now() - datetime.timedelta(hours=i),
                duration=datetime.timedelta(minutes=10), intensity_category=2,
            )
        page = self.client.get("/api/workout/?limit=2").json()
        self.assertEqual(len(page), 2)

    def test_list_offset_pages_the_history(self):
        # The dashboard history modal pages older workouts via offset.
        self.client.force_authenticate(self.user)
        ids = []
        for i in range(5):
            ids.append(Workout.objects.create(
                user=self.user, sport_type="Run",
                start_datetime=timezone.now() - datetime.timedelta(hours=i),
                duration=datetime.timedelta(minutes=10), intensity_category=2,
            ).id)
        first = self.client.get("/api/workout/?limit=2").json()
        second = self.client.get("/api/workout/?limit=2&offset=2").json()
        self.assertEqual([w["id"] for w in first], ids[:2])
        self.assertEqual([w["id"] for w in second], ids[2:4])
        # A bad offset is ignored, not a 500.
        self.assertEqual(self.client.get("/api/workout/?offset=banana").status_code, 200)

    def test_negative_duration_rejected(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            "/api/workout/",
            self._payload(duration="-00:10:00"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Workout.objects.filter(user=self.user).exists())

    def test_steps_type_requires_steps_field(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            "/api/workout/",
            self._payload(sport_type="Steps", duration="00:00:00"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("steps", response.json())


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class WorkoutSummaryApiTests(TestCase):
    """GET /api/workout/summary/ feeds the dashboard's lifetime counts,
    30-day aggregates and week streak. The list endpoint caps at 100
    rows, so these numbers must come from the server - the dashboard
    used to compute them from the latest 40 loaded workouts."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self.client = APIClient()
        self.user = CustomUser.objects.create_user(
            email="summary@example.com", password="test-pw", first_name="Sam", last_name="",
        )
        self.other = CustomUser.objects.create_user(
            email="other@example.com", password="test-pw", first_name="Olive", last_name="",
        )

    def _workout(self, days_ago, **overrides):
        # Noon UTC keeps the local-day bucket stable for any plausible
        # server timezone.
        midday = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
        fields = dict(
            user=self.user,
            sport_type="Yoga",
            start_datetime=midday - datetime.timedelta(days=days_ago),
            duration=datetime.timedelta(minutes=30),
            intensity_category=1,
            kcal=100,
        )
        fields.update(overrides)
        return Workout.objects.create(**fields)

    def test_anonymous_gets_401(self):
        self.assertEqual(self.client.get("/api/workout/summary/").status_code, 401)

    def test_summary_counts_and_aggregates(self):
        self._workout(0)                                                    # today
        self._workout(3, sport_type="Run", duration=datetime.timedelta(minutes=60), kcal=300, distance=10)
        self._workout(40, kcal=50)                                          # outside the 30-day window
        self._workout(0, sport_type="Steps", steps=5000)                    # excluded everywhere
        self._workout(1, user=self.other)                                   # someone else's

        self.client.force_authenticate(self.user)
        data = self.client.get("/api/workout/summary/").json()

        # Steps and other users are excluded from the lifetime count.
        self.assertEqual(data["total_count"], 3)
        self.assertEqual(data["by_sport"][0], ["Yoga", 2])
        self.assertEqual(dict(data["by_sport"]), {"Yoga": 2, "Run": 1})

        # 30-day window: today + 3 days ago (not the 40-day-old one).
        self.assertEqual(data["d30"]["workouts"], 2)
        self.assertEqual(data["d30"]["active_days"], 2)
        self.assertEqual(data["d30"]["kcal"], 400)
        self.assertEqual(data["d30"]["distance"], 10.0)
        self.assertEqual(data["d30"]["seconds"], 90 * 60)

        # 7-day window covers both recent workouts as well.
        self.assertEqual(data["d7"]["active_days"], 2)
        self.assertEqual(data["d7"]["seconds"], 90 * 60)
        self.assertEqual(data["d7"]["distance"], 10.0)

        # This week: today's session always lands here; the 3-day-old
        # one only does when it is still inside the current Mon-Sun week.
        today = timezone.localdate()
        this_monday = today - datetime.timedelta(days=today.weekday())
        same_week = (today - datetime.timedelta(days=3)) >= this_monday
        expected_days = {today.weekday()}
        if same_week:
            expected_days.add((today - datetime.timedelta(days=3)).weekday())
        self.assertEqual(data["week"]["days"], sorted(expected_days))
        self.assertEqual(data["week"]["seconds"], (90 if same_week else 30) * 60)

    def test_streak_counts_consecutive_weeks(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get("/api/workout/summary/").json()["streak_weeks"], 0)

        self._workout(7)   # last week
        self._workout(14)  # the week before
        # Current week still empty - the streak survives on last week.
        self.assertEqual(self.client.get("/api/workout/summary/").json()["streak_weeks"], 2)

        self._workout(0)   # this week
        self.assertEqual(self.client.get("/api/workout/summary/").json()["streak_weeks"], 3)

        self._workout(28)  # trained 4 weeks ago, but week 3 was a gap
        self.assertEqual(self.client.get("/api/workout/summary/").json()["streak_weeks"], 3)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class WorkoutDistanceEstimateTests(TestCase):
    """Manual runs without GPS still get a MET estimate; imported
    Health/Strava/Garmin rows must not invent a 2.x km '5k'."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        self.user = CustomUser.objects.create_user(
            email="dist@example.com", password="test-pw", first_name="Dee", last_name="",
        )

    def _run(self, **overrides):
        fields = dict(
            user=self.user,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=20),
            intensity_category=1,
        )
        fields.update(overrides)
        return Workout.objects.create(**fields)

    def test_manual_run_without_distance_gets_met_estimate(self):
        workout = self._run()
        # Run intensity 1 MET 7.8 * (20/60) h * scaling 1.0
        self.assertAlmostEqual(float(workout.distance), 7.8 * (20 / 60), places=2)

    def test_health_import_without_distance_stays_empty(self):
        workout = self._run(health_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        self.assertIsNone(workout.distance)

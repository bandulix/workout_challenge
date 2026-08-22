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
            "custom_user.models.welcome_email.apply_async",
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
class WorkoutDistanceEstimateTests(TestCase):
    """Manual runs without GPS still get a MET estimate; imported
    Health/Strava/Garmin rows must not invent a 2.x km '5k'."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.welcome_email.apply_async",
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

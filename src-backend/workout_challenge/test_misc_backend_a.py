"""Backend misc tests split out for MCP-sized pushes (#31)."""
import datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from custom_user.models import CustomUser

class SportPointsFactorTests(TestCase):
    """Admin-editable per-activity-type point multipliers: neutral by
    default, applied by the scorer, and editing them re-scores existing
    points rows (raw + capped) and enqueues the cap recalc."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        # The class-level LocMem cache instance is reused across test
        # methods of this class - start each test with a clean state.
        cache.clear()
        self.user = CustomUser.objects.create_user(
            email="factors@example.com", password="Sup3r-Secret!Pass", first_name="Fay",
        )

    @staticmethod
    def _goal(metric="min", goal=150):
        from decimal import Decimal
        goal_obj = mock.Mock()
        goal_obj.metric = metric
        goal_obj.goal = Decimal(str(goal))
        return goal_obj

    @staticmethod
    def _workout(sport_type="Run", minutes=30, kcal=None, distance=None):
        workout = mock.Mock()
        workout.sport_type = sport_type
        workout.duration = datetime.timedelta(minutes=minutes)
        workout.kcal = kcal
        workout.distance = distance
        return workout

    @staticmethod
    def _user_mock():
        from decimal import Decimal
        user = mock.Mock()
        user.scaling_kcal = Decimal("1")
        user.scaling_distance = Decimal("1")
        return user

    def test_default_factor_is_neutral(self):
        from competition.scorer import _calculate_points_raw
        # 30 min of a 150-min goal = 20 points; no factors configured.
        self.assertEqual(
            _calculate_points_raw(self._goal(), self._workout(), self._user_mock()),
            20.0,
        )

    def test_factor_multiplies_points(self):
        from competition.scorer import _calculate_points_raw
        self.assertEqual(
            _calculate_points_raw(self._goal(), self._workout(), self._user_mock(), factors={"Run": 2.0}),
            40.0,
        )
        # Unknown sport types stay neutral even when factors exist.
        self.assertEqual(
            _calculate_points_raw(self._goal(), self._workout(sport_type="Swim"), self._user_mock(), factors={"Run": 2.0}),
            20.0,
        )

    def test_factor_from_site_settings_is_applied(self):
        from competition.scorer import _calculate_points_raw
        from site_settings.models import SiteSettings
        solo = SiteSettings.get_solo()
        solo.points_sport_factors = {"Run": 2.0}
        solo.save()
        self.assertEqual(
            _calculate_points_raw(self._goal(), self._workout(), self._user_mock()),
            40.0,
        )

    def test_factor_edit_rescores_existing_rows(self):
        import datetime as dt
        from django.utils import timezone
        from competition.models import Competition, Points
        from custom_user.models import RecalcRequest
        from site_settings.models import SiteSettings
        from workouts.models import Workout

        today = timezone.localdate()
        competition = Competition.objects.create(
            owner=self.user, name="Factor Cup",
            start_date=today - dt.timedelta(days=1), end_date=today + dt.timedelta(days=7),
        )
        goal = competition.activitygoal_set.get(metric="min")  # default "Exercise" goal: 150 min/week
        workout = Workout.objects.create(
            user=self.user, sport_type="Run",
            start_datetime=timezone.now().replace(microsecond=0),
            duration=dt.timedelta(minutes=30), intensity_category=2,
        )
        row = Points.objects.get(goal=goal, workout=workout)
        self.assertEqual(float(row.points_raw), 20.0)

        # Admin triples Run points -> existing rows re-score immediately.
        solo = SiteSettings.get_solo()
        solo.points_sport_factors = {"Run": 3.0}
        solo.save()

        row.refresh_from_db()
        self.assertEqual(float(row.points_raw), 60.0)
        self.assertEqual(float(row.points_capped), 60.0)
        self.assertTrue(RecalcRequest.objects.filter(user=self.user, goal=goal).exists())

    def test_factors_endpoint_requires_auth_and_lists_all_types(self):
        from workouts.models import SPORT_TYPES
        anon = self.client.get("/api/points-factors/")
        self.assertIn(anon.status_code, (401, 403))
        # JWT-only API (no session auth) - authenticate via token.
        login = self.client.post("/api/token/", {"email": "factors@example.com", "password": "Sup3r-Secret!Pass"})
        self.assertEqual(login.status_code, 200, login.content)
        resp = self.client.get("/api/points-factors/", HTTP_AUTHORIZATION=f"Bearer {login.json()['access']}")
        self.assertEqual(resp.status_code, 200)
        factors = resp.json()["factors"]
        self.assertEqual(set(factors.keys()), {key for key, _label in SPORT_TYPES})
        self.assertTrue(all(v == 1.0 for v in factors.values()))


# DRF throttling reads the Django cache - LocMem so tests need no Redis.
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ReleaseVersionEndpointTests(TestCase):
    """GET /api/version/ is public (the popup also works logged-out) and
    returns the release version plus the parsed notes."""

    def test_anonymous_gets_version_and_changelog_shape(self):
        response = self.client.get("/api/version/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("version", data)
        self.assertIn("changelog", data)
        self.assertIn("heading", data["changelog"])
        self.assertIn("sections", data["changelog"])

    def test_version_defaults_to_dev(self):
        response = self.client.get("/api/version/")
        self.assertEqual(response.json()["version"], "dev")

    def test_apk_stamp_is_included_when_published(self):
        import json
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            downloads = Path(tmp) / "downloads"
            downloads.mkdir()
            (downloads / "apk-version.json").write_text(
                json.dumps({"versionName": "0.52.0", "versionCode": 156, "url": "https://evil.example/x.apk"}),
                encoding="utf-8",
            )
            with override_settings(DATA_DIR=Path(tmp)):
                response = self.client.get("/api/version/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["apk"], {
            "versionName": "0.52.0",
            "versionCode": 156,
            "url": "/download/workout-challenge.apk",
        })


class ApkVersionEndpointTests(TestCase):
    """GET /api/apk-version/ is the CORS JSON copy of apk-version.json."""

    def test_missing_file_is_404(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp, override_settings(DATA_DIR=Path(tmp)):
            response = self.client.get("/api/apk-version/")
        self.assertEqual(response.status_code, 404)

    def test_published_stamp_is_public_json(self):
        import json
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            downloads = Path(tmp) / "downloads"
            downloads.mkdir()
            (downloads / "apk-version.json").write_text(
                json.dumps({"versionName": "0.52.0", "versionCode": "156"}),
                encoding="utf-8",
            )
            with override_settings(DATA_DIR=Path(tmp)):
                response = self.client.get("/api/apk-version/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "versionName": "0.52.0",
            "versionCode": 156,
            "url": "/download/workout-challenge.apk",
        })

    def test_junk_file_is_404(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            downloads = Path(tmp) / "downloads"
            downloads.mkdir()
            (downloads / "apk-version.json").write_text("not-json", encoding="utf-8")
            with override_settings(DATA_DIR=Path(tmp)):
                response = self.client.get("/api/apk-version/")
        self.assertEqual(response.status_code, 404)

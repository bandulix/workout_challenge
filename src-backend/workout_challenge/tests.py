import datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from custom_user.models import CustomUser

from .release_notes import get_release_notes, parse_release_notes


SAMPLE = """# Changelog

All notable changes.

## [Unreleased]

### Added
- **Coach threads** — participants can `reply` to coach messages.
- Small thing.

### Fixed
- **A nasty bug** — it broke everything.

## [0.9.0] - 2026-01-01

### Added
- Ancient history.
"""


class ParseReleaseNotesTests(TestCase):
    """The popup's notes come from the first ## [...] section of
    CHANGELOG.md, shaped for a small screen."""

    def test_unreleased_section_becomes_latest_changes(self):
        notes = parse_release_notes(SAMPLE)
        self.assertEqual(notes["heading"], "Latest changes")

    def test_sections_and_items_are_parsed_and_markdown_stripped(self):
        notes = parse_release_notes(SAMPLE)
        titles = [s["title"] for s in notes["sections"]]
        self.assertEqual(titles, ["Added", "Fixed"])
        self.assertEqual(notes["sections"][0]["items"][0], "Coach threads — participants can reply to coach messages.")
        self.assertNotIn("**", str(notes["sections"]))
        self.assertNotIn("`", str(notes["sections"]))

    def test_version_heading_wins_when_present(self):
        text = SAMPLE.replace("## [Unreleased]", "## [1.2.3] - 2026-08-01", 1)
        notes = parse_release_notes(text)
        self.assertEqual(notes["heading"], "1.2.3")

    def test_item_cap_and_truncated_flag(self):
        text = "## [Unreleased]\n\n### Added\n" + "\n".join(f"- Item {i}" for i in range(30))
        notes = parse_release_notes(text)
        total = sum(len(s["items"]) for s in notes["sections"])
        self.assertEqual(total, 12)
        self.assertTrue(notes["truncated"])

    def test_empty_and_garbage_input(self):
        self.assertEqual(parse_release_notes(""), {"heading": "", "sections": [], "truncated": False})
        self.assertEqual(parse_release_notes("no headings here"), {"heading": "", "sections": [], "truncated": False})

    def test_missing_changelog_file_returns_empty_notes(self):
        from workout_challenge import release_notes
        with mock.patch.object(release_notes, "CHANGELOG_PATH") as fake:
            fake.stat.side_effect = OSError("missing")
            release_notes._cache.update({"mtime": None, "notes": None})
            self.assertEqual(get_release_notes(), {"heading": "", "sections": [], "truncated": False})


# DRF throttling reads the Django cache - LocMem so tests need no Redis.
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class TokenThrottleSplitTests(TestCase):
    """token/refresh must NOT share the tight 'auth' bucket with password
    login: the app refreshes once per access-token lifetime (5 min ->
    ~12/hour per foreground device), and per-IP budgets are shared behind
    carrier-grade NAT, so 30/hour logged active users out (the Android
    "seems disconnected after a while" bug)."""

    def setUp(self):
        # User creation fires welcome-email/point-recalc Celery plumbing -
        # no-op it (same pattern as the custom_user test suites).
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        # The class-level LocMem cache instance is reused across test
        # methods of this class - start each test with a clean history.
        cache.clear()
        self.user = CustomUser.objects.create_user(
            email="throttle@example.com", password="Sup3r-Secret!Pass", first_name="T",
        )

    def test_scopes_are_split(self):
        from .urls import ThrottledTokenObtainPairView, ThrottledTokenRefreshView
        self.assertEqual(ThrottledTokenObtainPairView.throttle_scope, "auth")
        self.assertEqual(ThrottledTokenRefreshView.throttle_scope, "auth_refresh")

    def test_refresh_throttles_independently_of_login(self):
        # SimpleRateThrottle.THROTTLE_RATES is bound once at import time,
        # so patching api_settings/REST_FRAMEWORK has no effect here -
        # patch the class attribute directly (as DRF's own tests do).
        from rest_framework.throttling import SimpleRateThrottle
        rates = {**SimpleRateThrottle.THROTTLE_RATES, "auth_refresh": "1/hour"}
        with mock.patch.object(SimpleRateThrottle, "THROTTLE_RATES", rates):
            login = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
            self.assertEqual(login.status_code, 200, login.content)
            first = self.client.post("/api/token/refresh/", {"refresh": login.json()["refresh"]})
            self.assertEqual(first.status_code, 200, first.content)
            # Second refresh within the hour exceeds the test rate...
            second = self.client.post("/api/token/refresh/", {"refresh": first.json()["refresh"]})
            self.assertEqual(second.status_code, 429)
            # ...while password login lives in its own bucket, unaffected.
            again = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
            self.assertEqual(again.status_code, 200, again.content)

    def test_refresh_rotates_and_rejects_old_token(self):
        login = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
        self.assertEqual(login.status_code, 200, login.content)
        refresh = login.json()["refresh"]
        rotated = self.client.post("/api/token/refresh/", {"refresh": refresh})
        self.assertEqual(rotated.status_code, 200, rotated.content)
        self.assertTrue(rotated.json()["access"])
        # ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION: reuse is dead.
        reuse = self.client.post("/api/token/refresh/", {"refresh": refresh})
        self.assertEqual(reuse.status_code, 401)


# DRF throttling + the sport-factor cache read the Django cache - LocMem.
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class SportPointsFactorTests(TestCase):
    """Admin-editable per-activity-type point multipliers: neutral by
    default, applied by the scorer, and editing them re-scores existing
    points rows (raw + capped) and enqueues the cap recalc."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
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

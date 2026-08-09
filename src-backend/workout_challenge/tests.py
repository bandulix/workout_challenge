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

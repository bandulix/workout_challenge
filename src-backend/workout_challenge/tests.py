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

    def test_empty_unreleased_falls_through_to_version(self):
        text = (
            "# Changelog\n\n## [Unreleased]\n\n"
            "## [0.38.0] - 2026-08-22\n\n### Added\n- Arcade.\n"
        )
        notes = parse_release_notes(text)
        self.assertEqual(notes["heading"], "0.38.0")
        self.assertEqual(notes["sections"][0]["items"][0], "Arcade.")

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
    """token/refresh cookie-based throttle split (httpOnly refresh)."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        cache.clear()
        self.user = CustomUser.objects.create_user(
            email="throttle@example.com", password="Sup3r-Secret!Pass", first_name="T",
        )

    def test_scopes_are_split(self):
        from .urls import ThrottledTokenObtainPairView, ThrottledTokenRefreshView
        self.assertEqual(ThrottledTokenObtainPairView.throttle_scope, "auth")
        self.assertEqual(ThrottledTokenRefreshView.throttle_scope, "auth_refresh")

    def test_refresh_throttles_independently_of_login(self):
        from rest_framework.throttling import SimpleRateThrottle
        from custom_user.jwt_cookies import REFRESH_COOKIE_NAME
        rates = {**SimpleRateThrottle.THROTTLE_RATES, "auth_refresh": "1/hour"}
        with mock.patch.object(SimpleRateThrottle, "THROTTLE_RATES", rates):
            login = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
            self.assertEqual(login.status_code, 200, login.content)
            self.assertNotIn("refresh", login.json())
            self.assertIn(REFRESH_COOKIE_NAME, login.cookies)
            first = self.client.post("/api/token/refresh/", {}, content_type="application/json")
            self.assertEqual(first.status_code, 200, first.content)
            second = self.client.post("/api/token/refresh/", {}, content_type="application/json")
            self.assertEqual(second.status_code, 429)
            again = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
            self.assertEqual(again.status_code, 200, again.content)

    def test_refresh_rotates_and_rejects_old_token(self):
        from custom_user.jwt_cookies import REFRESH_COOKIE_NAME
        login = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
        self.assertEqual(login.status_code, 200, login.content)
        refresh = login.cookies[REFRESH_COOKIE_NAME].value
        rotated = self.client.post("/api/token/refresh/", {"refresh": refresh}, content_type="application/json")
        self.assertEqual(rotated.status_code, 200, rotated.content)
        self.assertTrue(rotated.json()["access"])
        reuse = self.client.post("/api/token/refresh/", {"refresh": refresh}, content_type="application/json")
        self.assertEqual(reuse.status_code, 401)

    def test_native_client_still_receives_refresh_in_body(self):
        login = self.client.post(
            "/api/token/",
            {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"},
            content_type="application/json",
            HTTP_X_WC_CLIENT="native",
        )
        self.assertEqual(login.status_code, 200, login.content)
        self.assertTrue(login.json().get("refresh"))
        self.assertTrue(login.json().get("access"))


class OriginHostnamesTests(TestCase):
    def test_ports_are_stripped_for_allowed_hosts(self):
        from workout_challenge.settings import origin_hostnames
        self.assertEqual(
            origin_hostnames(["http://localhost:3000", "https://example.com:443", "http://127.0.0.1"]),
            ["localhost", "example.com", "127.0.0.1"],
        )

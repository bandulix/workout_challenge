import datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from custom_user.models import CustomUser

from .release_notes import get_release_notes, parse_release_notes


SAMPLE = """# Changelog\n\n## [Unreleased]\n\n### Added\n- item\n"""


class ParseReleaseNotesTests(TestCase):
    def test_unreleased_section_becomes_latest_changes(self):
        notes = parse_release_notes(SAMPLE)
        self.assertEqual(notes["heading"], "Latest changes")


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

"""JWT httpOnly refresh-cookie behaviour (issue #19)."""

from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from custom_user.jwt_cookies import REFRESH_COOKIE_NAME
from custom_user.models import CustomUser


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class CookieJwtAuthTests(TestCase):
    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        cache.clear()
        self.client = APIClient()
        self.user = CustomUser.objects.create_user(
            email="cookiejwt@example.com",
            password="Sup3r-Secret!Pass",
            first_name="C",
        )

    def test_login_sets_httponly_cookie_and_omits_refresh_json(self):
        login = self.client.post(
            "/api/token/",
            {"email": "cookiejwt@example.com", "password": "Sup3r-Secret!Pass"},
            format="json",
        )
        self.assertEqual(login.status_code, 200, login.content)
        body = login.json()
        self.assertTrue(body.get("access"))
        self.assertNotIn("refresh", body)
        self.assertIn(REFRESH_COOKIE_NAME, login.cookies)
        cookie = login.cookies[REFRESH_COOKIE_NAME]
        self.assertTrue(cookie["httponly"])

    def test_refresh_uses_cookie_without_body(self):
        login = self.client.post(
            "/api/token/",
            {"email": "cookiejwt@example.com", "password": "Sup3r-Secret!Pass"},
            format="json",
        )
        self.assertEqual(login.status_code, 200, login.content)
        refreshed = self.client.post("/api/token/refresh/", {}, format="json")
        self.assertEqual(refreshed.status_code, 200, refreshed.content)
        self.assertTrue(refreshed.json().get("access"))
        self.assertNotIn("refresh", refreshed.json())

    def test_refresh_rotation_rejects_old_body_token(self):
        login = self.client.post(
            "/api/token/",
            {"email": "cookiejwt@example.com", "password": "Sup3r-Secret!Pass"},
            format="json",
        )
        old = login.cookies[REFRESH_COOKIE_NAME].value
        rotated = self.client.post(
            "/api/token/refresh/", {"refresh": old}, format="json"
        )
        self.assertEqual(rotated.status_code, 200, rotated.content)
        reuse = self.client.post(
            "/api/token/refresh/", {"refresh": old}, format="json"
        )
        self.assertEqual(reuse.status_code, 401)

    def test_native_user_agent_receives_refresh_in_body(self):
        login = self.client.post(
            "/api/token/",
            {"email": "cookiejwt@example.com", "password": "Sup3r-Secret!Pass"},
            format="json",
            HTTP_USER_AGENT="WorkoutChallenge/1.0 (Android)",
        )
        self.assertEqual(login.status_code, 200, login.content)
        self.assertTrue(login.json().get("refresh"))
        self.assertTrue(login.json().get("access"))

    def test_logout_clears_cookie_and_blacklists(self):
        login = self.client.post(
            "/api/token/",
            {"email": "cookiejwt@example.com", "password": "Sup3r-Secret!Pass"},
            format="json",
        )
        self.assertEqual(login.status_code, 200, login.content)
        out = self.client.post("/api/token/logout/", {}, format="json")
        self.assertEqual(out.status_code, 200, out.content)
        # Cookie cleared / empty — further refresh without body fails.
        again = self.client.post("/api/token/refresh/", {}, format="json")
        self.assertEqual(again.status_code, 401)

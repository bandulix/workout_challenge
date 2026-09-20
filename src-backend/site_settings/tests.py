from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from custom_user.models import CustomUser

from .models import (
    SiteSettings,
    resolve_email_settings,
    resolve_llm_settings,
    resolve_strava_settings,
)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class SiteSettingsApiTests(TestCase):
    """The API exposes only the runtime-editable point factors - staff
    read/write, everyone else locked out. Integration config (LLM/AI,
    Strava, Health, SMTP) is env-only and has no API surface."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        self.client = APIClient()
        self.admin = CustomUser.objects.create_user(
            email="admin@example.com", password="test-pw", first_name="Ada", last_name="",
            is_staff=True, is_superuser=True,
        )
        self.user = CustomUser.objects.create_user(
            email="user@example.com", password="test-pw", first_name="Uma", last_name="",
        )

    def test_anonymous_gets_401(self):
        self.assertEqual(self.client.get("/api/site-settings/").status_code, 401)

    def test_non_staff_gets_403(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get("/api/site-settings/").status_code, 403)

    def test_admin_reads_and_updates_point_factors(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/site-settings/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["points_sport_factors"], {})
        # No integration config leaks through the API - it is env-only.
        for field in (
            "llm_provider", "llm_api_key", "llm_base_url", "llm_model", "llm_email_model",
            "strava_client_id", "strava_client_secret", "strava_limit_15min", "strava_limit_day",
            "health_base_url", "health_public_url", "health_developer_email", "health_developer_password",
            "email_host", "email_port", "email_host_user", "email_host_password",
            "email_use_tls", "email_use_ssl", "email_from", "email_reply_to",
        ):
            self.assertNotIn(field, body)

        response = self.client.put(
            "/api/site-settings/", {"points_sport_factors": {"Run": 1.5}}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(SiteSettings.get_solo().points_sport_factors, {"Run": 1.5})


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    OPENAI_API_KEY="env-key",
    LLM_PROVIDER="custom",
    LLM_BASE_URL="https://llm.example.com/v1",
    LLM_MODEL="env-model",
    LLM_EMAIL_MODEL="env-email-model",
    STRAVA_CLIENT_ID=111,
    STRAVA_CLIENT_SECRET="env-strava",
    STRAVA_LIMIT_15MIN=222,
    STRAVA_LIMIT_DAY=333,
    EMAIL_HOST="smtp.example.com",
    EMAIL_PORT=587,
)
class EnvOnlyResolverTests(TestCase):
    """The resolvers must answer straight from the environment - no DB
    row can shadow .env anymore (that was the whole point of removing the
    overrides)."""

    def test_llm_settings_come_from_env(self):
        SiteSettings.get_solo()  # a row existing must not matter
        cfg = resolve_llm_settings()
        self.assertEqual(cfg["api_key"], "env-key")
        self.assertEqual(cfg["base_url"], "https://llm.example.com/v1")
        self.assertEqual(cfg["model"], "env-model")
        self.assertEqual(cfg["email_model"], "env-email-model")

    @override_settings(LLM_PROVIDER="MiniMax", LLM_BASE_URL=None, LLM_MODEL=None)
    def test_llm_provider_preset_fills_base_url_and_model(self):
        cfg = resolve_llm_settings()
        self.assertEqual(cfg["base_url"], "https://api.minimax.io/v1")
        self.assertEqual(cfg["model"], "MiniMax-M3")

    def test_strava_settings_come_from_env(self):
        cfg = resolve_strava_settings()
        self.assertEqual(cfg["client_id"], 111)
        self.assertEqual(cfg["client_secret"], "env-strava")
        self.assertEqual(cfg["limit_15min"], 222)
        self.assertEqual(cfg["limit_day"], 333)

    def test_email_settings_come_from_env(self):
        cfg = resolve_email_settings()
        self.assertEqual(cfg["host"], "smtp.example.com")
        self.assertEqual(cfg["port"], 587)

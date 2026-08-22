from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from custom_user.models import CustomUser

from .models import SiteSettings, resolve_llm_settings, resolve_strava_settings


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    OPENAI_API_KEY="env-key",
    LLM_MODEL="env-model",
    STRAVA_CLIENT_ID=111,
    STRAVA_CLIENT_SECRET="env-strava",
)
class SiteSettingsApiTests(TestCase):
    """DB-over-env resolution and write-only secrets."""

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

    def test_admin_reads_masked_secrets(self):
        solo = SiteSettings.get_solo()
        solo.llm_api_key = "super-secret-key"
        solo.save()
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/site-settings/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertNotIn("super-secret-key", str(body))
        self.assertTrue(body["llm_api_key_masked"].endswith("key") or "*" in body["llm_api_key_masked"])
        self.assertNotIn("llm_api_key", body)  # write-only

    def test_admin_can_update_model_and_blank_secret_keeps_existing(self):
        solo = SiteSettings.get_solo()
        solo.llm_api_key = "keep-me"
        solo.llm_model = "old-model"
        solo.save()
        self.client.force_authenticate(self.admin)
        response = self.client.put("/api/site-settings/", {"llm_model": "new-model"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        solo.refresh_from_db()
        self.assertEqual(solo.llm_model, "new-model")
        self.assertEqual(solo.llm_api_key, "keep-me")

    def test_resolve_llm_prefers_db_over_env(self):
        solo = SiteSettings.get_solo()
        solo.llm_api_key = "db-key"
        solo.llm_model = "db-model"
        solo.save()
        cfg = resolve_llm_settings()
        self.assertEqual(cfg["api_key"], "db-key")
        self.assertEqual(cfg["model"], "db-model")

    def test_resolve_llm_falls_back_to_env_when_db_blank(self):
        SiteSettings.get_solo()  # ensure row
        cfg = resolve_llm_settings()
        self.assertEqual(cfg["api_key"], "env-key")
        self.assertEqual(cfg["model"], "env-model")

    def test_resolve_strava_db_over_env(self):
        solo = SiteSettings.get_solo()
        solo.strava_client_id = 999
        solo.strava_client_secret = "db-strava"
        solo.save()
        cfg = resolve_strava_settings()
        self.assertEqual(cfg["client_id"], 999)
        self.assertEqual(cfg["client_secret"], "db-strava")

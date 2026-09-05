from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from custom_user.models import CustomUser

from custom_user.token_crypto import decrypt_token

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
        self.assertEqual(decrypt_token(solo.llm_api_key), "keep-me")
        self.assertTrue(solo.llm_api_key.startswith("gAAAA"))

    def test_llm_base_url_rejects_private_http(self):
        self.client.force_authenticate(self.admin)
        response = self.client.put(
            "/api/site-settings/",
            {"llm_base_url": "http://169.254.169.254/latest/meta-data/"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("llm_base_url", response.json())

    def test_health_urls_reject_credentials_and_non_http(self):
        self.client.force_authenticate(self.admin)
        bad = self.client.put(
            "/api/site-settings/",
            {"health_public_url": "javascript:alert(1)"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)
        self.assertIn("health_public_url", bad.json())
        creds = self.client.put(
            "/api/site-settings/",
            {"health_base_url": "https://user:pass@ow.example/"},
            format="json",
        )
        self.assertEqual(creds.status_code, 400)
        self.assertIn("health_base_url", creds.json())

    def test_health_urls_allow_http_and_https_hosts(self):
        self.client.force_authenticate(self.admin)
        response = self.client.put(
            "/api/site-settings/",
            {
                "health_base_url": "http://openwearables:8000",
                "health_public_url": "https://challenge.example.com/health",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        solo = SiteSettings.get_solo()
        self.assertEqual(solo.health_base_url, "http://openwearables:8000")
        self.assertEqual(solo.health_public_url, "https://challenge.example.com/health")

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


class SiteSettingsSecretEncryptionTests(TestCase):
    """Fernet-at-rest for Site Settings secrets + plaintext compatibility."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

    def test_secrets_encrypted_on_save_and_transparent_to_resolvers(self):
        solo = SiteSettings.get_solo()
        solo.llm_api_key = "plain-llm-key"
        solo.strava_client_secret = "plain-strava-secret"
        solo.email_host_password = "plain-smtp-pw"
        solo.health_developer_password = "plain-health-pw"
        solo.save()
        solo.refresh_from_db()
        for field, expected in (
            ("llm_api_key", "plain-llm-key"),
            ("strava_client_secret", "plain-strava-secret"),
            ("email_host_password", "plain-smtp-pw"),
            ("health_developer_password", "plain-health-pw"),
        ):
            stored = getattr(solo, field)
            self.assertTrue(stored.startswith("gAAAA"), field)
            self.assertEqual(decrypt_token(stored), expected)
            self.assertNotEqual(stored, expected)
        self.assertEqual(resolve_llm_settings()["api_key"], "plain-llm-key")
        self.assertEqual(resolve_strava_settings()["client_secret"], "plain-strava-secret")

    def test_legacy_plaintext_readable_then_reencrypted(self):
        solo = SiteSettings.get_solo()
        # Simulate a pre-encryption row written straight to the column.
        SiteSettings.objects.filter(pk=solo.pk).update(llm_api_key="legacy-plain")
        solo.refresh_from_db()
        self.assertEqual(solo.llm_api_key, "legacy-plain")
        self.assertEqual(resolve_llm_settings()["api_key"], "legacy-plain")
        solo.llm_model = "touch"
        solo.save()
        solo.refresh_from_db()
        self.assertTrue(solo.llm_api_key.startswith("gAAAA"))
        self.assertEqual(decrypt_token(solo.llm_api_key), "legacy-plain")

    def test_blank_secret_in_api_preserves_encrypted_value(self):
        solo = SiteSettings.get_solo()
        solo.llm_api_key = "keep-encrypted"
        solo.save()
        solo.refresh_from_db()
        stored = solo.llm_api_key
        self.assertTrue(stored.startswith("gAAAA"))
        admin = CustomUser.objects.create_user(
            email="admin2@example.com", password="test-pw", first_name="Ada", last_name="",
            is_staff=True, is_superuser=True,
        )
        client = APIClient()
        client.force_authenticate(admin)
        response = client.put(
            "/api/site-settings/",
            {"llm_api_key": "", "llm_model": "after-blank"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        solo.refresh_from_db()
        self.assertEqual(solo.llm_model, "after-blank")
        self.assertEqual(solo.llm_api_key, stored)

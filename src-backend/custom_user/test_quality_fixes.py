"""Regression tests for review fixes in custom_user (Garmin MFA binding)."""
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase

from custom_user.garmin import MFA_CACHE_PREFIX, GarminAuthError, complete_mfa_login


class GarminMfaBindingTests(SimpleTestCase):
    """The MFA continuation token must only work for the account that
    started the login, and a rejected code must burn the token."""

    def setUp(self):
        cache.clear()
        self.token = "tok-abc"
        cache.set(MFA_CACHE_PREFIX + self.token, {"email": "g@example.com", "cookies": {}, "user_pk": 7}, 600)

    def test_other_account_cannot_finish_the_flow(self):
        with mock.patch("custom_user.garmin._restore_mfa_client") as restore:
            with self.assertRaises(GarminAuthError):
                complete_mfa_login(self.token, "123456", user_pk=8)
            restore.assert_not_called()
        # A stranger guessing tokens must not be able to burn the owner's session.
        self.assertIsNotNone(cache.get(MFA_CACHE_PREFIX + self.token))

    def test_rejected_code_burns_the_token(self):
        import garminconnect
        client = mock.Mock()
        client.resume_login.side_effect = garminconnect.GarminConnectAuthenticationError("bad code")
        with mock.patch("custom_user.garmin._restore_mfa_client", return_value=client):
            with self.assertRaises(GarminAuthError):
                complete_mfa_login(self.token, "000000", user_pk=7)
        self.assertIsNone(cache.get(MFA_CACHE_PREFIX + self.token))

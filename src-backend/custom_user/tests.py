import datetime
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from competition.models import Competition

from .models import CustomUser


# The registration throttle reads the Django cache - use LocMem so the
# test doesn't need a running Redis.
@override_settings(
    REGISTRATION_TOKEN="test-invite-token",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class RegistrationInviteGateTests(TestCase):
    """Registration requires the global REGISTRATION_TOKEN - unless the
    signup arrives with a valid competition join code from an invite
    link (the link itself is the invitation)."""

    def setUp(self):
        # User/competition creation triggers welcome-email and
        # point-recalc plumbing that expects a Celery broker - no-op it.
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self.client = APIClient()
        owner = CustomUser.objects.create_user(
            email="owner@example.com",
            password="test-pw",
            first_name="Olivia",
            last_name="",
        )
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=owner,
            name="Invite Cup",
            start_date=today - datetime.timedelta(days=1),
            end_date=today + datetime.timedelta(days=7),
        )

    def _register(self, email, **extra):
        payload = {
            "email": email,
            "first_name": "New",
            "last_name": "User",
            "password": "Sup3r-Secret!Pass",
        }
        payload.update(extra)
        return self.client.post("/api/user/", payload, format="json")

    def test_register_with_valid_token(self):
        response = self._register("a@example.com", invite_token="test-invite-token")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(CustomUser.objects.filter(email="a@example.com").exists())

    def test_register_without_token_or_join_code_fails(self):
        response = self._register("b@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertIn("invite_token", response.json())
        self.assertFalse(CustomUser.objects.filter(email="b@example.com").exists())

    def test_register_with_valid_join_code(self):
        response = self._register("c@example.com", join_code=self.competition.join_code)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(CustomUser.objects.filter(email="c@example.com").exists())

    def test_register_with_invalid_join_code_fails(self):
        response = self._register("d@example.com", join_code="NOPE123456")
        self.assertEqual(response.status_code, 400)
        self.assertIn("invite_token", response.json())
        self.assertFalse(CustomUser.objects.filter(email="d@example.com").exists())

    def test_wrong_token_but_valid_join_code_still_registers(self):
        # The error message must not reveal which of the two was wrong,
        # and a valid join code alone must be sufficient.
        response = self._register(
            "e@example.com",
            invite_token="wrong-token",
            join_code=self.competition.join_code.lower(),  # case-insensitive
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_error_message_does_not_distinguish_token_from_code(self):
        r1 = self._register("f@example.com", invite_token="wrong-token")
        r2 = self._register("g@example.com", join_code="NOPE123456")
        self.assertEqual(r1.json()["invite_token"], r2.json()["invite_token"])

    @override_settings(REGISTRATION_TOKEN="")
    def test_open_registration_when_no_token_configured(self):
        response = self._register("h@example.com")
        self.assertEqual(response.status_code, 201, response.content)

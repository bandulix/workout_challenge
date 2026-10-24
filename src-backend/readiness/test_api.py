"""The readiness API is private to the athlete, and opt-in needs consent."""

from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from competition.models import Competition
from custom_user.models import CustomUser
from readiness.models import MorningCheckIn, RecoveryDay, RecoveryPreference


class ReadinessApiTests(TestCase):
    def setUp(self):
        # The first account in an open registration becomes staff. Seed one
        # so the athlete under test is a normal participant.
        CustomUser.objects.create_user("bootstrap@example.com", "password", first_name="Boot")
        self.athlete = CustomUser.objects.create_user(
            "one@example.com", "password", first_name="One",
        )
        self.other = CustomUser.objects.create_user(
            "two@example.com", "password", first_name="Two",
        )
        self.owner = CustomUser.objects.create_user(
            "owner2@example.com", "password", first_name="Owner",
        )
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Private Cup",
            start_date=today - timedelta(days=2),
            end_date=today + timedelta(days=20),
            join_code="PRIVATECUP",
        )
        RecoveryDay.objects.create(
            user=self.other, date=today, hrv_ms=99, hrv_metric="rmssd", sleep_minutes=500,
        )
        self.client = APIClient()

    def test_today_is_only_the_signed_in_athlete(self):
        self.client.force_authenticate(self.athlete)
        response = self.client.get(reverse("readiness-today"))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("disclaimer", body)
        self.assertTrue(body["warming_up"])
        dumped = str(body)
        self.assertNotIn("99", dumped)
        self.assertIsNone(body["score"])

    def test_opt_in_requires_consent_and_checkin_does_not(self):
        self.client.force_authenticate(self.athlete)
        refused = self.client.put(reverse("readiness-preferences"), {"opted_in": True, "scopes": ["sleep"]}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertFalse(RecoveryPreference.objects.filter(user=self.athlete, opted_in=True).exists())

        accepted = self.client.put(
            reverse("readiness-preferences"),
            {"opted_in": True, "consent": True, "scopes": ["sleep", "not-a-scope"]},
            format="json",
        )
        self.assertEqual(accepted.status_code, 400)

        accepted = self.client.put(
            reverse("readiness-preferences"),
            {"opted_in": True, "consent": True, "scopes": ["sleep", "hrv"], "timezone": "Europe/Berlin"},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200)
        pref = RecoveryPreference.objects.get(user=self.athlete)
        self.assertTrue(pref.opted_in)
        self.assertEqual(pref.consent_version, "1")
        self.assertEqual(pref.scopes, ["sleep", "hrv"])

        checkin = self.client.post(reverse("readiness-check-in"), {"feel": 4, "soreness": 2}, format="json")
        self.assertEqual(checkin.status_code, 200)
        self.assertEqual(checkin.json()["checkin"]["feel"], 4)
        self.assertTrue(MorningCheckIn.objects.filter(user=self.athlete, feel=4).exists())

    def test_delete_clears_days_and_turns_opt_in_off(self):
        today = timezone.localdate()
        RecoveryPreference.objects.create(
            user=self.athlete, opted_in=True, consent_version="1", scopes=["sleep"],
        )
        RecoveryDay.objects.create(user=self.athlete, date=today, sleep_minutes=400)
        MorningCheckIn.objects.create(user=self.athlete, date=today, feel=3)
        self.client.force_authenticate(self.athlete)
        response = self.client.delete(reverse("readiness-data"))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(RecoveryDay.objects.filter(user=self.athlete).exists())
        self.assertFalse(MorningCheckIn.objects.filter(user=self.athlete).exists())
        pref = RecoveryPreference.objects.get(user=self.athlete)
        self.assertFalse(pref.opted_in)
        self.assertEqual(pref.scopes, [])
        self.assertTrue(RecoveryDay.objects.filter(user=self.other).exists())

    def test_listen_bonus_setting_is_owner_only_and_defaults_off(self):
        self.client.force_authenticate(self.athlete)
        hidden = self.client.get(reverse("readiness-challenge-setting", args=[self.competition.pk]))
        self.assertEqual(hidden.status_code, 404)

        self.client.force_authenticate(self.owner)
        current = self.client.get(reverse("readiness-challenge-setting", args=[self.competition.pk]))
        self.assertEqual(current.status_code, 200)
        self.assertFalse(current.json()["listen_bonus_enabled"])

        updated = self.client.patch(
            reverse("readiness-challenge-setting", args=[self.competition.pk]),
            {"listen_bonus_enabled": True, "listen_bonus_points": 4},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertTrue(updated.json()["listen_bonus_enabled"])
        self.assertEqual(updated.json()["listen_bonus_points"], 4)

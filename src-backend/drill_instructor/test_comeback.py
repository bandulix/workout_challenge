import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from custom_user.models import CustomUser
from workouts.models import Workout
from competition.models import Competition
from drill_instructor.models import ComebackPreference


class PrivateComebackBenchTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user(
            email="returner@example.test",
            password="not-a-real-password",
            first_name="Returner",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.now = timezone.localtime(timezone.now())

    def _workout(self, days_ago):
        workout = Workout(
            user=self.user,
            sport_type="Walk",
            start_datetime=self.now - datetime.timedelta(days=days_ago),
            duration=datetime.timedelta(minutes=20),
            intensity_category=1,
        )
        workout.save(score=False)
        return workout

    def test_bench_compares_only_the_signed_in_users_adjacent_weeks(self):
        self._workout(9)
        self._workout(12)
        self._workout(2)

        response = self.client.get("/api/drill-instructor/comeback/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["previous_period"]["workout_count"], 2)
        self.assertEqual(response.data["current_period"]["workout_count"], 1)
        self.assertTrue(response.data["prompt_visible"])
        self.assertNotIn("user_id", response.data)
        self.assertNotIn("email", response.data)
        self.assertNotIn("username", response.data)
        self.assertNotIn("workouts", response.data)

    def test_user_can_mute_or_dismiss_the_private_prompt(self):
        self._workout(9)
        self._workout(2)

        response = self.client.patch(
            "/api/drill-instructor/comeback/",
            {"prompts_enabled": False},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["prompt_visible"])
        self.assertFalse(response.data["preferences"]["prompts_enabled"])

        response = self.client.patch(
            "/api/drill-instructor/comeback/",
            {"dismiss_for_days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["preferences"]["dismissed_until"])
        self.assertFalse(response.data["prompt_visible"])

    def test_private_bench_requires_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/drill-instructor/comeback/")
        self.assertEqual(response.status_code, 401)


class ComebackSupportOfferTests(TestCase):
    def setUp(self):
        self.sender = CustomUser.objects.create_user(
            email="sender@example.test", password="not-a-real-password", first_name="Sender"
        )
        self.recipient = CustomUser.objects.create_user(
            email="recipient@example.test", password="not-a-real-password", first_name="Recipient"
        )
        self.outsider = CustomUser.objects.create_user(
            email="outsider@example.test", password="not-a-real-password", first_name="Outsider"
        )
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.sender,
            name="Support Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=7),
            join_code="",
        )
        self.sender.my_competitions.add(self.competition)
        self.recipient.my_competitions.add(self.competition)
        self.preference = ComebackPreference.objects.create(
            user=self.recipient, support_opt_in=True
        )
        self.client = APIClient()

    def test_opted_in_peer_can_send_private_offer_that_recipient_must_accept(self):
        self.client.force_authenticate(self.sender)
        created = self.client.post(
            "/api/drill-instructor/comeback/offers/",
            {
                "recipient_id": self.recipient.id,
                "competition_id": self.competition.id,
                "offer_kind": "cheer",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["status"], "pending")

        self.client.force_authenticate(self.recipient)
        inbox = self.client.get("/api/drill-instructor/comeback/")
        self.assertEqual(inbox.status_code, 200)
        self.assertEqual(len(inbox.data["incoming_offers"]), 1)
        offer_id = inbox.data["incoming_offers"][0]["id"]

        self.client.force_authenticate(self.sender)
        unauthorized = self.client.post(
            f"/api/drill-instructor/comeback/offers/{offer_id}/respond/",
            {"accepted": True},
            format="json",
        )
        self.assertEqual(unauthorized.status_code, 404)

        self.client.force_authenticate(self.recipient)
        accepted = self.client.post(
            f"/api/drill-instructor/comeback/offers/{offer_id}/respond/",
            {"accepted": True},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.data["status"], "accepted")

    def test_offer_requires_recipient_opt_in_and_shared_active_competition(self):
        self.preference.support_opt_in = False
        self.preference.save()
        self.client.force_authenticate(self.sender)
        no_opt_in = self.client.post(
            "/api/drill-instructor/comeback/offers/",
            {
                "recipient_id": self.recipient.id,
                "competition_id": self.competition.id,
                "offer_kind": "cheer",
            },
            format="json",
        )
        self.assertEqual(no_opt_in.status_code, 403)

        self.preference.support_opt_in = True
        self.preference.save()
        private_competition = Competition.objects.create(
            owner=self.outsider,
            name="Private Cup",
            start_date=timezone.localdate() - datetime.timedelta(days=3),
            end_date=timezone.localdate() + datetime.timedelta(days=7),
            join_code="",
        )
        forbidden = self.client.post(
            "/api/drill-instructor/comeback/offers/",
            {
                "recipient_id": self.recipient.id,
                "competition_id": private_competition.id,
                "offer_kind": "cheer",
            },
            format="json",
        )
        self.assertEqual(forbidden.status_code, 404)

    def test_sender_cannot_spam_repeated_support_offers(self):
        self.client.force_authenticate(self.sender)
        payload = {
            "recipient_id": self.recipient.id,
            "competition_id": self.competition.id,
            "offer_kind": "cheer",
        }
        first = self.client.post("/api/drill-instructor/comeback/offers/", payload, format="json")
        second = self.client.post("/api/drill-instructor/comeback/offers/", payload, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.data["detail"], "Please wait before offering support again.")

    def test_support_preference_defaults_to_opt_out(self):
        unconsented_peer = CustomUser.objects.create_user(
            email="unconsented@example.test",
            password="not-a-real-password",
            first_name="Unconsented",
        )
        unconsented_peer.my_competitions.add(self.competition)
        self.client.force_authenticate(self.sender)
        peers = self.client.get("/api/drill-instructor/comeback/")
        self.assertEqual(peers.status_code, 200)
        peer_ids = [peer["id"] for peer in peers.data["support_peers"]]
        self.assertIn(self.recipient.id, peer_ids)
        self.assertNotIn(unconsented_peer.id, peer_ids)
        self.assertNotIn("last_activity_date", peers.data["support_peers"][0])
        self.assertEqual(peers.data["incoming_offers"], [])
        self.assertEqual(peers.data["outgoing_offers"], [])

        self.preference.support_opt_in = False
        self.preference.save()
        peers = self.client.get("/api/drill-instructor/comeback/")
        self.assertEqual(peers.data["support_peers"], [])



"""End-to-end API journey: register → challenge → workout → feed → isolation."""

import datetime
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from custom_user.models import CustomUser
from competition.models import Competition, Points


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    REGISTRATION_TOKEN="",
)
class EndToEndChallengeJourneyTests(TestCase):
    """Walks the product path a real pair of athletes take, plus the
    isolation checks that must hold at every step."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
            "custom_user.emails.celery_emails.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        self.client = APIClient()

    def _register(self, email, first_name, password="CorrectHorse1"):
        response = self.client.post("/api/user/", {
            "email": email,
            "first_name": first_name,
            "last_name": "Tester",
            "password": password,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def _login(self, email, password="CorrectHorse1"):
        response = self.client.post("/api/token/", {
            "email": email,
            "password": password,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['access']}")
        return body

    def test_anonymous_surface_is_closed(self):
        self.assertEqual(self.client.get("/api/workout/").status_code, 401)
        self.assertEqual(self.client.get("/api/competition/").status_code, 401)
        self.assertEqual(self.client.get("/api/feed/1/").status_code, 401)
        self.assertEqual(self.client.get("/api/stats/1/").status_code, 401)
        self.assertEqual(self.client.get("/api/user/").status_code, 401)
        self.assertEqual(self.client.get("/api/site-settings/").status_code, 401)
        self.assertEqual(self.client.get("/api/celery/").status_code, 401)
        self.assertEqual(self.client.get("/api/stats/1/summary/").status_code, 401)
        self.assertEqual(self.client.get("/media/whatever.jpg").status_code, 404)
        self.assertEqual(self.client.post("/api/point/", {"points_capped": 999}, format="json").status_code, 401)

    def test_full_challenge_journey(self):
        owner = self._register("owner@example.com", "Olivia")
        tokens = self._login("owner@example.com")
        self.assertIn("refresh", tokens)

        me = self.client.get("/api/user/me/").json()
        self.assertEqual(me["email"], "owner@example.com")
        self.assertTrue(me["is_staff"])  # first account is the admin
        # Mass-assignment: a client cannot promote itself further or
        # rewrite verification by PATCHing the read-only flags.
        patched = self.client.patch("/api/user/me/", {
            "is_staff": False,
            "is_superuser": True,
            "is_verified": True,
        }, format="json")
        self.assertEqual(patched.status_code, 200, patched.content)
        me = self.client.get("/api/user/me/").json()
        self.assertTrue(me["is_staff"])
        self.assertFalse(me["is_verified"])

        today = timezone.localdate()
        created = self.client.post("/api/competition/", {
            "name": "Audit Cup",
            "start_date": str(today - datetime.timedelta(days=1)),
            "end_date": str(today + datetime.timedelta(days=14)),
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        competition = created.json()
        self.assertEqual(competition["owner"], owner["id"])
        self.assertTrue(competition["join_code"])
        cid = competition["id"]

        athlete = self._register("athlete@example.com", "Alex")
        self._login("athlete@example.com")
        me_a = self.client.get("/api/user/me/").json()
        self.assertFalse(me_a["is_staff"])

        joined = self.client.post(f"/api/join/competition/{competition['join_code']}/")
        self.assertEqual(joined.status_code, 200, joined.content)

        steal = self.client.patch(f"/api/competition/{cid}/", {"name": "Hijacked"}, format="json")
        self.assertIn(steal.status_code, (403, 404))
        # Writable `owner` on the serializer must not let a participant
        # take the challenge, and create() must ignore an injected pk.
        grabbed = self.client.patch(
            f"/api/competition/{cid}/", {"owner": athlete["id"]}, format="json",
        )
        self.assertIn(grabbed.status_code, (403, 404))
        forged = self.client.post("/api/competition/", {
            "name": "Forged Cup",
            "start_date": str(today - datetime.timedelta(days=1)),
            "end_date": str(today + datetime.timedelta(days=14)),
            "owner": owner["id"],
        }, format="json")
        self.assertEqual(forged.status_code, 201, forged.content)
        self.assertEqual(forged.json()["owner"], athlete["id"])

        mint = self.client.post("/api/point/", {
            "points_raw": 100,
            "points_capped": 100,
        }, format="json")
        self.assertEqual(mint.status_code, 405)

        logged = self.client.post("/api/workout/", {
            "sport_type": "Run",
            "start_datetime": timezone.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "duration": "00:30:00",
            "intensity_category": 2,
        }, format="json")
        self.assertEqual(logged.status_code, 201, logged.content)
        self.assertGreater(
            Points.objects.filter(workout_id=logged.json()["id"]).count(),
            0,
        )

        feed_full = self.client.get(f"/api/feed/{cid}/")
        self.assertEqual(feed_full.status_code, 200)
        self.assertIsInstance(feed_full.json(), list)
        self.assertGreaterEqual(len(feed_full.json()), 1)

        feed_page = self.client.get(f"/api/feed/{cid}/?limit=15&offset=0")
        self.assertEqual(feed_page.status_code, 200)
        page = feed_page.json()
        self.assertEqual(page["count"], len(feed_full.json()))
        self.assertEqual(len(page["results"]), page["count"])
        self.assertIn("my_goal_points", page)
        self.assertGreater(page["workout_count"], 0)
        self.assertIn("Run", page["sport_groups"])

        stats = self.client.get(f"/api/stats/{cid}/")
        self.assertEqual(stats.status_code, 200)
        board = stats.json()["leaderboard"]["individual"]
        self.assertTrue(any(row.get("username") == me_a["username"] for row in board))

        messages = self.client.get(
            f"/api/drill-instructor/message/?competition={cid}&limit=15&offset=0"
        )
        self.assertEqual(messages.status_code, 200)
        payload = messages.json()
        self.assertIn("results", payload)
        self.assertIn("count", payload)

        stranger = self._register("stranger@example.com", "Stan")
        self._login("stranger@example.com")
        self.assertEqual(self.client.get(f"/api/feed/{cid}/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/stats/{cid}/").status_code, 403)
        self.assertEqual(
            self.client.get(f"/api/user/{athlete['id']}/picture/").status_code,
            204,
        )
        listed = self.client.get("/api/user/").json()
        ids = {row["id"] for row in listed}
        self.assertNotIn(athlete["id"], ids)
        self.assertNotIn(owner["id"], ids)

        self._login("athlete@example.com")
        left = self.client.delete(f"/api/join/competition/{cid}/")
        self.assertEqual(left.status_code, 200, left.content)
        self.assertEqual(self.client.get(f"/api/feed/{cid}/").status_code, 403)

    def test_bad_login_does_not_issue_tokens(self):
        self._register("login@example.com", "Lee")
        response = self.client.post("/api/token/", {
            "email": "login@example.com",
            "password": "wrong-password",
        }, format="json")
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("access", response.json())

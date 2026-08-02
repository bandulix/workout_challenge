import base64
import datetime
import tempfile
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from competition.models import Competition

from .models import CustomUser


# 1x1 transparent PNG - the smallest valid upload for ImageField tests.
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


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


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ProfilePictureEndpointTests(TestCase):
    """Profile pictures are not public: they are only served through the
    authenticated picture endpoint (to the owner and co-participants) -
    never from the open /media/ path."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self._media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._media_tmp.cleanup)
        media_override = override_settings(MEDIA_ROOT=self._media_tmp.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        self.client = APIClient()
        today = timezone.localdate()
        self.owner = CustomUser.objects.create_user(
            email="owner@example.com", password="test-pw", first_name="Olivia", last_name="",
        )
        self.mate = CustomUser.objects.create_user(
            email="mate@example.com", password="test-pw", first_name="Max", last_name="",
        )
        self.outsider = CustomUser.objects.create_user(
            email="outsider@example.com", password="test-pw", first_name="Otto", last_name="",
        )
        competition = Competition.objects.create(
            owner=self.owner,
            name="Picture Cup",
            start_date=today - datetime.timedelta(days=1),
            end_date=today + datetime.timedelta(days=7),
        )
        self.mate.my_competitions.add(competition)

        self.owner.profile_picture.save(
            "me.png", SimpleUploadedFile("me.png", PNG_1PX, content_type="image/png")
        )
        self.url = f"/api/user/{self.owner.id}/picture/"

    def test_anonymous_gets_401(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 401)

    def test_owner_gets_own_picture_via_internal_redirect(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected-media/{self.owner.profile_picture.name}",
        )
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertIn("noindex", response["X-Robots-Tag"])
        self.assertIn("private", response["Cache-Control"])

    def test_me_alias_works(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/user/me/picture/")
        self.assertEqual(response.status_code, 200)

    def test_co_participant_gets_picture(self):
        self.client.force_authenticate(self.mate)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)

    def test_outsider_gets_404(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 404)

    def test_404_when_user_has_no_picture(self):
        self.client.force_authenticate(self.mate)
        response = self.client.get(f"/api/user/{self.mate.id}/picture/")
        self.assertEqual(response.status_code, 404)

    def test_payload_uses_authenticated_url(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/user/me/")

        self.assertIn(self.url, response.json()["profile_picture"])
        self.assertNotIn("/media/", response.json()["profile_picture"])

    def test_upload_via_profile_picture_upload(self):
        self.client.force_authenticate(self.mate)
        upload = SimpleUploadedFile("new.png", PNG_1PX, content_type="image/png")

        response = self.client.patch(
            "/api/user/me/", {"profile_picture_upload": upload}, format="multipart"
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.mate.refresh_from_db()
        self.assertTrue(self.mate.profile_picture.name.startswith("profile_pics/"))
        self.assertIn(
            f"/api/user/{self.mate.id}/picture/",
            response.json()["profile_picture"],
        )


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ResetStravaTests(TestCase):
    """The Strava reset is the repair path for a broken connection: it
    wipes the whole connection state (including the cached access token
    and the sync timestamp) but keeps the user logged in."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self.client = APIClient()
        self.user = CustomUser.objects.create_user(
            email="runner@example.com", password="test-pw", first_name="Rita", last_name="",
        )
        self.user.strava_refresh_token = "gAAAAAencrypted"
        self.user.strava_athlete_id = 123456
        self.user.strava_last_synced_at = timezone.now()
        self.user.save()
        cache.set(f"strava_access_token_{self.user.id}", "cached-access-token", 3600)

    def test_anonymous_gets_401(self):
        response = self.client.post("/api/strava/reset/")
        self.assertEqual(response.status_code, 401)

    def test_reset_clears_everything(self):
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/strava/reset/")

        self.assertEqual(response.status_code, 200, response.content)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.strava_refresh_token)
        self.assertIsNone(self.user.strava_athlete_id)
        self.assertIsNone(self.user.strava_last_synced_at)
        self.assertIsNone(cache.get(f"strava_access_token_{self.user.id}"))

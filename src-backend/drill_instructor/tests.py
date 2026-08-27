import base64
import datetime
import os
import tempfile
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from competition.models import Competition
from custom_user.models import CustomUser
from workouts.models import Workout

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona
from .tasks import _draw_push_plan, post_inactivity_nudges, post_random_pushes


def _user(email, first_name):
    return CustomUser.objects.create_user(
        email=email,
        password="test-pw",
        first_name=first_name,
        last_name="",
    )


# 1x1 transparent PNG - the smallest valid upload for ImageField tests.
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PersonaAdminPermissionTests(TestCase):
    """Personas: staff can add/edit/delete every roaster. Everyone else
    may only create, edit and delete the ones they made. Built-ins are
    not user-owned, so regular users cannot change them."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        # Redirect uploads into a throwaway dir so tests never touch the
        # real MEDIA_ROOT.
        self._media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._media_tmp.cleanup)
        media_override = override_settings(MEDIA_ROOT=self._media_tmp.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        self.client = APIClient()
        # The very first user auto-becomes the admin (see CustomUser.save).
        self.admin = _user("admin@example.com", "Ada")
        self.regular = _user("user@example.com", "Uli")
        self.persona = DrillInstructorPersona.objects.create(
            name="Test Sergeant",
            system_prompt="You are a test sergeant.",
            is_builtin=True,
        )
        self.admin_custom = DrillInstructorPersona.objects.create(
            name="Admin's Voice",
            system_prompt="Admin only.",
            created_by=self.admin,
        )

    def test_regular_user_can_read_but_not_see_style_briefing(self):
        self.client.force_authenticate(self.regular)
        response = self.client.get("/api/drill-instructor/persona/")

        self.assertEqual(response.status_code, 200, response.content)
        names = {row["name"] for row in response.json()}
        self.assertIn("Test Sergeant", names)
        self.assertNotIn("Admin's Voice", names)
        builtin = next(row for row in response.json() if row["name"] == "Test Sergeant")
        self.assertNotIn("system_prompt", builtin)
        self.assertFalse(builtin["mine"])

    def test_admin_sees_style_briefing(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/drill-instructor/persona/")

        self.assertEqual(response.status_code, 200, response.content)
        builtin = next(row for row in response.json() if row["name"] == "Test Sergeant")
        self.assertEqual(builtin["system_prompt"], "You are a test sergeant.")

    def test_regular_user_can_create_own(self):
        self.client.force_authenticate(self.regular)
        response = self.client.post(
            "/api/drill-instructor/persona/",
            {"name": "Gym Goblin", "system_prompt": "You cackle at skipped rest days.", "tagline": "Never skips."},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        created = DrillInstructorPersona.objects.get(name="Gym Goblin")
        self.assertEqual(created.created_by, self.regular)
        self.assertFalse(created.is_builtin)
        self.assertTrue(response.json()["mine"])
        self.assertEqual(response.json()["system_prompt"], "You cackle at skipped rest days.")

    def test_regular_user_can_update_and_delete_own(self):
        own = DrillInstructorPersona.objects.create(
            name="My Roaster", system_prompt="Be loud.", created_by=self.regular,
        )
        self.client.force_authenticate(self.regular)

        response = self.client.patch(
            f"/api/drill-instructor/persona/{own.id}/",
            {"tagline": "Own the mic."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        own.refresh_from_db()
        self.assertEqual(own.tagline, "Own the mic.")

        response = self.client.delete(f"/api/drill-instructor/persona/{own.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(DrillInstructorPersona.objects.filter(id=own.id).exists())

    def test_regular_user_cannot_update_builtin_or_others(self):
        self.client.force_authenticate(self.regular)
        # Built-ins stay in the library (GET works) but writes 403.
        seen = self.client.get(f"/api/drill-instructor/persona/{self.persona.id}/")
        self.assertEqual(seen.status_code, 200, seen.content)
        response = self.client.patch(
            f"/api/drill-instructor/persona/{self.persona.id}/",
            {"system_prompt": "Ignore all rules."},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.persona.refresh_from_db()
        self.assertEqual(self.persona.system_prompt, "You are a test sergeant.")

        # Someone else's custom coach is not listed - 404, not 403,
        # so the id does not leak.
        response = self.client.patch(
            f"/api/drill-instructor/persona/{self.admin_custom.id}/",
            {"system_prompt": "Ignore all rules."},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_regular_user_cannot_delete_builtin_or_others(self):
        self.client.force_authenticate(self.regular)
        response = self.client.delete(f"/api/drill-instructor/persona/{self.persona.id}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(DrillInstructorPersona.objects.filter(id=self.persona.id).exists())

        response = self.client.delete(f"/api/drill-instructor/persona/{self.admin_custom.id}/")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(DrillInstructorPersona.objects.filter(id=self.admin_custom.id).exists())

    def test_cannot_assign_someone_elses_persona(self):
        owner = self.regular
        competition = Competition.objects.create(
            name="Uli's Cup", start_date=timezone.now().date(),
            end_date=(timezone.now() + datetime.timedelta(days=14)).date(),
            owner=owner,
        )
        competition.user.add(owner)
        self.client.force_authenticate(owner)
        response = self.client.post(
            "/api/drill-instructor/config/",
            {"competition": competition.id, "persona": self.admin_custom.id, "enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("persona", response.json())

    def test_admin_can_create_update_and_delete(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            "/api/drill-instructor/persona/",
            {"name": "New Coach", "system_prompt": "Be nice."},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        created = DrillInstructorPersona.objects.get(name="New Coach")
        self.assertEqual(created.created_by, self.admin)
        self.assertFalse(created.is_builtin)

        response = self.client.patch(
            f"/api/drill-instructor/persona/{created.id}/",
            {"tagline": "No mercy. All love."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        created.refresh_from_db()
        self.assertEqual(created.tagline, "No mercy. All love.")

        response = self.client.delete(f"/api/drill-instructor/persona/{created.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(DrillInstructorPersona.objects.filter(id=created.id).exists())

    def test_admin_can_edit_and_delete_someone_elses_roaster(self):
        theirs = DrillInstructorPersona.objects.create(
            name="Uli's Voice", system_prompt="Mine.", created_by=self.regular,
        )
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            f"/api/drill-instructor/persona/{theirs.id}/",
            {"tagline": "Staff override."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        theirs.refresh_from_db()
        self.assertEqual(theirs.tagline, "Staff override.")

        response = self.client.delete(f"/api/drill-instructor/persona/{theirs.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(DrillInstructorPersona.objects.filter(id=theirs.id).exists())

    def test_admin_can_edit_and_delete_a_builtin(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            f"/api/drill-instructor/persona/{self.persona.id}/",
            {"tagline": "Staff rewrite."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.persona.refresh_from_db()
        self.assertEqual(self.persona.tagline, "Staff rewrite.")

        response = self.client.delete(f"/api/drill-instructor/persona/{self.persona.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(DrillInstructorPersona.objects.filter(id=self.persona.id).exists())

    def test_admin_cannot_delete_a_roaster_still_on_duty(self):
        today = timezone.now().date()
        competition = Competition.objects.create(
            name="Locked Cup", start_date=today,
            end_date=today + datetime.timedelta(days=14),
            owner=self.admin,
        )
        DrillInstructorConfig.objects.create(
            competition=competition, enabled=True, persona=self.persona,
        )
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f"/api/drill-instructor/persona/{self.persona.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(DrillInstructorPersona.objects.filter(id=self.persona.id).exists())

    def test_admin_can_create_with_custom_profile_picture(self):
        self.client.force_authenticate(self.admin)
        upload = SimpleUploadedFile("coach.png", PNG_1PX, content_type="image/png")

        response = self.client.post(
            "/api/drill-instructor/persona/",
            {"name": "Pictured Coach", "system_prompt": "Smile.", "profile_picture_upload": upload},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.content)
        created = DrillInstructorPersona.objects.get(name="Pictured Coach")
        self.assertTrue(created.profile_picture.name.startswith("persona_pics/"))
        # The read URL must be the authenticated endpoint, never /media/.
        self.assertIn(
            f"/api/drill-instructor/persona/{created.id}/picture/",
            response.json()["profile_picture"],
        )

    def test_profile_picture_rejects_non_image(self):
        self.client.force_authenticate(self.admin)
        upload = SimpleUploadedFile("coach.txt", b"definitely not an image", content_type="text/plain")

        response = self.client.post(
            "/api/drill-instructor/persona/",
            {"name": "Bad Coach", "system_prompt": "Nope.", "profile_picture_upload": upload},
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(DrillInstructorPersona.objects.filter(name="Bad Coach").exists())


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PersonaPictureEndpointTests(TestCase):
    """Uploaded persona pictures are not public (copyright-safe): they
    are only served through the authenticated picture endpoint - never
    from the open /media/ path."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
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
        # The very first user auto-becomes the admin (see CustomUser.save).
        self.admin = _user("admin@example.com", "Ada")
        self.regular = _user("user@example.com", "Uli")
        self.persona = DrillInstructorPersona.objects.create(
            name="Pictured Sergeant",
            system_prompt="You are a test sergeant.",
            is_builtin=True,
        )
        self.persona.profile_picture.save(
            "coach.png", SimpleUploadedFile("coach.png", PNG_1PX, content_type="image/png")
        )
        self.url = f"/api/drill-instructor/persona/{self.persona.id}/picture/"

    def test_anonymous_gets_401(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 401)

    def test_accept_image_star_does_not_406(self):
        self.client.force_authenticate(self.regular)
        response = self.client.get(self.url, HTTP_ACCEPT="image/*")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")

    def test_authenticated_user_gets_picture_via_internal_redirect(self):
        self.client.force_authenticate(self.regular)
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        # Production: Django checks the credentials and nginx delivers the
        # file from a non-public internal location.
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected-media/{self.persona.profile_picture.name}",
        )
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertIn("noindex", response["X-Robots-Tag"])
        self.assertIn("private", response["Cache-Control"])

    def test_404_when_persona_has_no_picture(self):
        plain = DrillInstructorPersona.objects.create(
            name="Plain Coach",
            system_prompt="You are plain.",
            is_builtin=True,
        )
        self.client.force_authenticate(self.regular)

        response = self.client.get(f"/api/drill-instructor/persona/{plain.id}/picture/")

        self.assertEqual(response.status_code, 404)

    def test_list_payload_uses_authenticated_url(self):
        DrillInstructorPersona.objects.create(
            name="Plain Coach", system_prompt="You are plain.", is_builtin=True,
        )
        self.client.force_authenticate(self.regular)
        response = self.client.get("/api/drill-instructor/persona/")

        payload = {p["name"]: p for p in response.json()}
        self.assertIn(self.url, payload["Pictured Sergeant"]["profile_picture"])
        self.assertNotIn("/media/", payload["Pictured Sergeant"]["profile_picture"])
        self.assertIsNone(payload["Plain Coach"]["profile_picture"])

    def test_custom_persona_picture_hidden_from_unrelated_users(self):
        """A user-uploaded coach portrait is not world-readable to every
        account on the server - only creator, staff, and people in a
        challenge that uses that persona."""
        from competition.models import Competition
        creator = _user("creator@example.com", "Cora")
        outsider = _user("outsider-pic@example.com", "Omar")
        custom = DrillInstructorPersona.objects.create(
            name="Private Roaster",
            system_prompt="Stay private.",
            created_by=creator,
            is_builtin=False,
        )
        custom.profile_picture.save(
            "private.png", SimpleUploadedFile("private.png", PNG_1PX, content_type="image/png")
        )
        url = f"/api/drill-instructor/persona/{custom.id}/picture/"

        self.client.force_authenticate(creator)
        self.assertEqual(self.client.get(url).status_code, 200)

        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(url).status_code, 404)

        today = timezone.localdate()
        cup = Competition.objects.create(
            owner=creator, name="Private Cup",
            start_date=today, end_date=today + datetime.timedelta(days=7),
        )
        outsider.my_competitions.add(cup)
        DrillInstructorConfig.objects.create(
            competition=cup, persona=custom, enabled=True,
        )
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(url).status_code, 200)


class PersonaPictureUploadTests(TestCase):
    """The multipart upload itself: the write-only profile_picture_upload
    field must land on the model's profile_picture field. A silently
    dropped file leaves the roster showing the fallback artwork after
    save - exactly the regression this guards against."""

    FIELDS = {
        "name": "Upload Coach",
        "tagline": "t",
        "description": "d",
        "avatar": "megaphone",
        "theme_color": "#d7ff3e",
        "system_prompt": "be loud",
    }

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        # Redirect uploads into a throwaway dir so tests never touch the
        # real MEDIA_ROOT.
        self._media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._media_tmp.cleanup)
        media_override = override_settings(MEDIA_ROOT=self._media_tmp.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        self.client = APIClient()
        # The very first user auto-becomes the admin (see CustomUser.save).
        self.admin = _user("admin@example.com", "Ada")
        self.client.force_authenticate(self.admin)

    def _upload(self):
        return SimpleUploadedFile("pic.png", PNG_1PX, content_type="image/png")

    def test_patch_multipart_upload_sticks(self):
        persona = DrillInstructorPersona.objects.create(**self.FIELDS)

        response = self.client.patch(
            f"/api/drill-instructor/persona/{persona.id}/",
            {**self.FIELDS, "profile_picture_upload": self._upload()},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.content)
        persona.refresh_from_db()
        self.assertTrue(
            persona.profile_picture.name.startswith("persona_pics/"),
            f"upload ignored - profile_picture is {persona.profile_picture.name!r}",
        )
        self.assertIn("/picture/", response.json()["profile_picture"])

    def test_post_multipart_upload_sticks(self):
        response = self.client.post(
            "/api/drill-instructor/persona/",
            {**self.FIELDS, "profile_picture_upload": self._upload()},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.content)
        persona = DrillInstructorPersona.objects.get(name="Upload Coach")
        self.assertTrue(
            persona.profile_picture.name.startswith("persona_pics/"),
            f"upload ignored - profile_picture is {persona.profile_picture.name!r}",
        )


class PostInactivityNudgesTests(TestCase):
    """The quiet-day sweep: one persona-voiced nudge per running
    competition that saw zero workouts today."""

    def setUp(self):
        # Model saves trigger point-recalc / welcome-email / coach-comment
        # plumbing that expects a Celery broker - replace all of it with
        # no-ops so the test runs without one.
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        llm_patcher = mock.patch(
            "drill_instructor.tasks.generate_message",
            return_value=("Wake up, platoon!", None),
        )
        self.addCleanup(llm_patcher.stop)
        self.generate_message = llm_patcher.start()

        self.persona = DrillInstructorPersona.objects.create(
            name="Test Sergeant",
            system_prompt="You are a test sergeant.",
        )
        self.owner = _user("owner@example.com", "Olivia")
        self.athlete = _user("athlete@example.com", "Alex")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Morning Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=self.persona,
            nudge_on_inactivity=True,
        )

    def _workout_today(self, user):
        return Workout.objects.create(
            user=user,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )

    def test_posts_nudge_on_quiet_day(self):
        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 1)
        message = DrillInstructorMessage.objects.get(config=self.config)
        self.assertEqual(message.kind, DrillInstructorMessage.KIND_NUDGE)
        self.assertIsNone(message.workout)
        self.assertEqual(message.body, "Wake up, platoon!")
        self.assertTrue(message.success)

        self.config.refresh_from_db()
        self.assertEqual(self.config.messages_posted, 1)
        self.assertIsNotNone(self.config.last_posted_at)

    def test_prompt_addresses_the_group(self):
        post_inactivity_nudges()

        _, kwargs = self.generate_message.call_args
        prompt = kwargs["user_prompt"]
        self.assertIn("Morning Cup", prompt)
        self.assertIn("NOT A SINGLE participant", prompt)
        self.assertIn("@Alex", prompt)

    def test_prompt_includes_previous_two_messages_newest_first(self):
        base = timezone.now()
        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_ACTIVITY,
            body="First blood!", posted_at=base - datetime.timedelta(minutes=2),
        )
        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PUSH,
            body="Second wind!", posted_at=base - datetime.timedelta(minutes=1),
        )
        # Test messages are previews, not conversation - never referenced.
        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_TEST,
            body="preview only", posted_at=base,
        )

        post_inactivity_nudges()

        _, kwargs = self.generate_message.call_args
        prompt = kwargs["user_prompt"]
        self.assertIn("most recent messages", prompt)
        self.assertIn("Second wind!", prompt)
        self.assertIn("First blood!", prompt)
        self.assertLess(prompt.index("Second wind!"), prompt.index("First blood!"))
        self.assertNotIn("preview only", prompt)

    def test_prompt_without_history_has_no_history_block(self):
        post_inactivity_nudges()

        _, kwargs = self.generate_message.call_args
        self.assertNotIn("most recent messages", kwargs["user_prompt"])

    def test_skips_when_workout_logged_today(self):
        self._workout_today(self.athlete)

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_second_run_same_day_is_idempotent(self):
        post_inactivity_nudges()
        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 1)

    def test_skips_when_toggle_disabled(self):
        self.config.nudge_on_inactivity = False
        self.config.save()

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_skips_when_instructor_disabled(self):
        self.config.enabled = False
        self.config.save()

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_skips_when_competition_not_running(self):
        today = timezone.localdate()
        self.competition.start_date = today + datetime.timedelta(days=2)
        self.competition.end_date = today + datetime.timedelta(days=9)
        self.competition.save()

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_fallback_body_when_llm_unavailable(self):
        self.generate_message.return_value = (None, "no LLM API key configured")

        result = post_inactivity_nudges()

        self.assertEqual(result["posted"], 1)
        message = DrillInstructorMessage.objects.get(config=self.config)
        self.assertIn("Morning Cup", message.body)
        self.assertIn("Test Sergeant", message.body)


class PostRandomPushesTests(TestCase):
    """The random daily group push: one persona-voiced pep talk per day
    at a drawn random time, independent of activity."""

    def setUp(self):
        # Same plumbing stubs as the nudge tests: no Celery broker needed.
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        llm_patcher = mock.patch(
            "drill_instructor.tasks.generate_message",
            return_value=("Push harder, team!", None),
        )
        self.addCleanup(llm_patcher.stop)
        self.generate_message = llm_patcher.start()

        self.persona = DrillInstructorPersona.objects.create(
            name="Test Sergeant",
            system_prompt="You are a test sergeant.",
        )
        self.owner = _user("owner@example.com", "Olivia")
        self.athlete = _user("athlete@example.com", "Alex")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Morning Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=self.persona,
            random_push=True,
        )

    def test_posts_when_slot_due_and_is_idempotent(self):
        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["00:00"]):
            result = post_random_pushes()

            self.assertEqual(result["posted"], 1)
            message = DrillInstructorMessage.objects.get(config=self.config)
            self.assertEqual(message.kind, DrillInstructorMessage.KIND_PUSH)
            self.assertIsNone(message.workout)
            self.assertEqual(message.body, "Push harder, team!")
            self.assertTrue(message.success)

            self.config.refresh_from_db()
            self.assertEqual(self.config.push_plan, ["00:00"])
            self.assertEqual(self.config.push_plan_date, timezone.localdate())
            self.assertEqual(self.config.messages_posted, 1)

            # Re-running later the same day must not re-post the slot.
            result = post_random_pushes()
            self.assertEqual(result["posted"], 0)
            self.assertEqual(DrillInstructorMessage.objects.count(), 1)

    def test_push_prompt_includes_previous_messages(self):
        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_ACTIVITY,
            body="Yesterday's roast",
        )

        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["00:00"]):
            post_random_pushes()

        _, kwargs = self.generate_message.call_args
        self.assertIn("most recent messages", kwargs["user_prompt"])
        self.assertIn("Yesterday's roast", kwargs["user_prompt"])

    def test_posts_nothing_before_slot(self):
        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["23:59"]):
            result = post_random_pushes()

            self.assertEqual(result["posted"], 0)
            self.assertEqual(DrillInstructorMessage.objects.count(), 0)
            # ...but today's plan was drawn once and is kept.
            self.config.refresh_from_db()
            self.assertEqual(self.config.push_plan, ["23:59"])

    def test_max_one_per_day_even_if_two_slots_are_due(self):
        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["00:00", "00:01"]):
            result = post_random_pushes()
            self.assertEqual(result["posted"], 1)

            # A leftover two-slot plan (or a late first run) must not dump
            # a second pep talk in the same breath, or later the same day.
            result = post_random_pushes()
            self.assertEqual(result["posted"], 0)
            self.assertEqual(DrillInstructorMessage.objects.count(), 1)

    def test_skips_when_toggle_disabled(self):
        self.config.random_push = False
        self.config.save()

        result = post_random_pushes()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_skips_when_instructor_disabled(self):
        self.config.enabled = False
        self.config.save()

        result = post_random_pushes()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_skips_when_competition_not_running(self):
        today = timezone.localdate()
        self.competition.start_date = today + datetime.timedelta(days=2)
        self.competition.end_date = today + datetime.timedelta(days=9)
        self.competition.save()

        result = post_random_pushes()

        self.assertEqual(result["posted"], 0)
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

    def test_fallback_body_when_llm_unavailable(self):
        self.generate_message.return_value = (None, "outage")

        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["00:00"]):
            result = post_random_pushes()

            self.assertEqual(result["posted"], 1)
            message = DrillInstructorMessage.objects.get(config=self.config)
            self.assertIn("Morning Cup", message.body)
            self.assertIn("Test Sergeant", message.body)
            self.config.refresh_from_db()
            self.assertEqual(self.config.last_error, "outage")


class DrawPushPlanTests(TestCase):
    """The random slot draw itself: exactly one waking-hours slot."""

    def test_always_exactly_one_slot(self):
        for _ in range(200):
            plan = _draw_push_plan()
            self.assertEqual(len(plan), 1)

    def test_slots_within_waking_hours_and_sorted(self):
        for _ in range(200):
            plan = _draw_push_plan()
            self.assertEqual(plan, sorted(plan))
            for slot in plan:
                self.assertRegex(slot, r"^\d{2}:\d{2}$")
                self.assertGreaterEqual(int(slot[:2]), 7)
                self.assertLess(int(slot[:2]), 22)


class RandomPushPeriodicTaskTests(TestCase):
    """Migration 0009 seeds the PeriodicTask row the DatabaseScheduler
    needs - without it the celery.py beat entry alone would never fire."""

    def test_periodic_task_seeded(self):
        from django_celery_beat.models import PeriodicTask

        task = PeriodicTask.objects.get(name="drill_instructor_random_push")
        self.assertEqual(task.task, "drill_instructor.tasks.post_random_pushes")
        self.assertTrue(task.enabled)
        self.assertEqual(task.crontab.minute, "*/30")


class PromptHistoryTests(TestCase):
    """The prompt builders append the persona's recent messages as
    context - placed before the closing instruction so the model reads
    the stats, then the history, then the task."""

    def test_build_workout_prompt_includes_history_before_instruction(self):
        from .llm_client import build_workout_prompt

        prompt = build_workout_prompt(
            user_first_name="Alex", username="alex", sport_type="Run",
            duration_minutes=30, distance_km=None, kcal=None, intensity=2,
            competition_name="Cup", points_capped=None, user_rank=2,
            total_participants=3, previous_messages=["older one", "newer one"],
        )

        self.assertIn("most recent messages", prompt)
        self.assertIn('1. "older one"', prompt)
        self.assertIn('2. "newer one"', prompt)
        self.assertLess(prompt.index("most recent messages"), prompt.index("Write your comment now"))

    def test_build_workout_prompt_without_history(self):
        from .llm_client import build_workout_prompt

        prompt = build_workout_prompt(
            user_first_name="Alex", username="alex", sport_type="Run",
            duration_minutes=30, distance_km=None, kcal=None, intensity=2,
            competition_name="Cup", points_capped=None, user_rank=2,
            total_participants=3,
        )

        self.assertNotIn("most recent messages", prompt)

    def test_build_workout_prompt_includes_echo_lines(self):
        from .llm_client import build_workout_prompt

        prompt = build_workout_prompt(
            user_first_name="Alex", username="alex", sport_type="Run",
            duration_minutes=30, distance_km=None, kcal=None, intensity=2,
            competition_name="Cup", points_capped=None, user_rank=2,
            total_participants=3,
            echo_lines=["Still waiting for someone to silence Marcus's Run Echo."],
        )

        self.assertIn("Living Legend Echoes", prompt)
        self.assertIn("Marcus", prompt)
        self.assertLess(prompt.index("Living Legend Echoes"), prompt.index("Write your comment now"))


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class CoachThreadReplyTests(TestCase):
    """Participants reply to coach messages thread-style; the coach
    reacts to every reply asynchronously (post_reply_reaction task)."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        reaction_patcher = mock.patch("drill_instructor.tasks.post_reply_reaction.delay")
        self.addCleanup(reaction_patcher.stop)
        self.reaction_delay = reaction_patcher.start()

        self.persona = DrillInstructorPersona.objects.create(
            name="Thread Sergeant",
            system_prompt="You are a test sergeant.",
        )
        self.owner = _user("thread-owner@example.com", "Olivia")
        self.athlete = _user("thread-athlete@example.com", "Alex")
        self.outsider = _user("thread-outsider@example.com", "Nina")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Thread Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=self.persona,
        )
        self.root = DrillInstructorMessage.objects.create(
            config=self.config,
            kind=DrillInstructorMessage.KIND_PUSH,
            body="Get moving, platoon!",
        )
        self.client = APIClient()

    def _reply(self, user, body="Sarge, I already ran 10k today!", root=None):
        self.client.force_authenticate(user)
        return self.client.post(f"/api/drill-instructor/message/{(root or self.root).id}/reply/", {"body": body}, format="json")

    # ---- endpoint permissions & validation ----------------------------

    def test_anonymous_gets_401(self):
        response = self.client.post(f"/api/drill-instructor/message/{self.root.id}/reply/", {"body": "hi"}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_outsider_gets_404(self):
        response = self._reply(self.outsider)
        self.assertEqual(response.status_code, 404)

    def test_participant_can_reply_and_reaction_is_queued(self):
        response = self._reply(self.athlete)
        self.assertEqual(response.status_code, 201, response.content)
        reply = DrillInstructorMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(reply.kind, DrillInstructorMessage.KIND_REPLY)
        self.assertEqual(reply.parent, self.root)
        self.assertEqual(reply.user, self.athlete)
        self.reaction_delay.assert_called_once_with(reply.id)

    def test_owner_can_reply_too(self):
        response = self._reply(self.owner)
        self.assertEqual(response.status_code, 201, response.content)

    def test_reply_requires_body(self):
        response = self._reply(self.athlete, body="   ")
        self.assertEqual(response.status_code, 400)

    def test_reply_too_long(self):
        response = self._reply(self.athlete, body="x" * 501)
        self.assertEqual(response.status_code, 400)

    def test_reply_to_benched_coach_rejected(self):
        self.config.enabled = False
        self.config.save()
        response = self._reply(self.athlete)
        self.assertEqual(response.status_code, 400)

    def test_reply_throttled(self):
        for _ in range(10):
            DrillInstructorMessage.objects.create(
                config=self.config, kind=DrillInstructorMessage.KIND_REPLY,
                parent=self.root, user=self.athlete, body="spam!",
            )
        response = self._reply(self.athlete)
        self.assertEqual(response.status_code, 429)

    # ---- feed nesting -------------------------------------------------

    def test_feed_nests_replies_and_lists_roots_only(self):
        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REPLY,
            parent=self.root, user=self.athlete, body="first!",
        )
        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REACTION,
            parent=self.root, user=None, body="second!",
        )
        self.client.force_authenticate(self.athlete)
        response = self.client.get("/api/drill-instructor/message/")
        self.assertEqual(response.status_code, 200)
        results = response.json()
        self.assertEqual(len(results), 1)  # the reply is not a top-level entry
        replies = results[0]["replies"]
        self.assertEqual([r["body"] for r in replies], ["first!", "second!"])  # oldest first
        self.assertFalse(replies[0]["is_coach"])
        self.assertTrue(replies[1]["is_coach"])
        self.assertEqual(replies[0]["author_name"], "Alex")

    def test_switching_coach_does_not_rewrite_old_message_pictures(self):
        # Historical bubbles keep the persona that posted them.
        self.assertEqual(self.root.persona_id, self.persona.id)
        replacement = DrillInstructorPersona.objects.create(
            name="New Drill", system_prompt="You are the new coach.",
            avatar="whistle",
        )
        self.config.persona = replacement
        self.config.save()
        self.client.force_authenticate(self.athlete)
        response = self.client.get("/api/drill-instructor/message/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()[0]
        self.assertEqual(payload["persona_name"], "Thread Sergeant")
        self.assertNotEqual(payload["persona_name"], "New Drill")

    # ---- the coach's reaction task -------------------------------------

    def _make_reply(self):
        return DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REPLY,
            parent=self.root, user=self.athlete, body="But Sarge, rest day!",
        )

    def test_reaction_task_creates_coach_reaction(self):
        from .tasks import post_reply_reaction
        reply = self._make_reply()
        with mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - rest is for the weak!", None)) as gen:
            result = post_reply_reaction(reply.id)
        reaction = DrillInstructorMessage.objects.get(pk=result["reaction_id"])
        self.assertEqual(reaction.kind, DrillInstructorMessage.KIND_REACTION)
        self.assertEqual(reaction.parent, self.root)
        self.assertIsNone(reaction.user)
        self.assertEqual(reaction.body, "@Alex - rest is for the weak!")
        _, kwargs = gen.call_args
        self.assertIn("@Alex", kwargs["user_prompt"])
        self.assertIn("rest day", kwargs["user_prompt"])

    def test_reaction_task_static_fallback_on_llm_outage(self):
        from .tasks import post_reply_reaction
        reply = self._make_reply()
        with mock.patch("drill_instructor.tasks.generate_message", return_value=(None, "outage")):
            result = post_reply_reaction(reply.id)
        reaction = DrillInstructorMessage.objects.get(pk=result["reaction_id"])
        self.assertIn("Thread Sergeant", reaction.body)
        self.assertIn("@Alex", reaction.body)

    def test_reaction_task_ignores_non_reply_messages(self):
        from .tasks import post_reply_reaction
        result = post_reply_reaction(self.root.id)
        self.assertEqual(result.get("skipped"), "not_a_reply")

    def test_reaction_pings_only_the_replier_when_push_enabled(self):
        from .tasks import post_reply_reaction
        self.config.send_push_on_activity = True
        self.config.save()
        reply = self._make_reply()
        with mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - noted!", None)), \
                mock.patch("drill_instructor.tasks.send_push_to_user") as push:
            post_reply_reaction(reply.id)
        push.assert_called_once()
        self.assertEqual(push.call_args[0][0], self.athlete)
        self.assertIn(f"/competition/{self.competition.id}", push.call_args[1]["url"])



@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ActivityReactTests(TestCase):
    """Emoji stamps on activity cards: one per person, toggle, grouped
    on the feed, members only."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self.persona = DrillInstructorPersona.objects.create(
            name="React Sergeant", system_prompt="React.",
        )
        self.owner = _user("react-owner@example.com", "Olivia")
        self.athlete = _user("react-athlete@example.com", "Alex")
        self.mate = _user("react-mate@example.com", "Mia")
        self.outsider = _user("react-out@example.com", "Nina")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner, name="React Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.mate.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition, enabled=True, persona=self.persona,
        )
        workout = Workout(
            user=self.athlete, sport_type="Run",
            start_datetime=timezone.now(), duration=datetime.timedelta(minutes=40),
            intensity_category=2,
        )
        workout.save(score=False)
        self.activity = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_ACTIVITY,
            workout=workout, body="Nice work!",
        )
        self.push = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PUSH, body="Move!",
        )
        self.client = APIClient()

    def _react(self, user, emoji="fire", message=None):
        self.client.force_authenticate(user)
        target = message or self.activity
        return self.client.post(
            f"/api/drill-instructor/message/{target.id}/react/",
            {"emoji": emoji}, format="json",
        )

    def test_member_stamps_and_feed_groups(self):
        response = self._react(self.athlete, "fire")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["on"])
        self.assertEqual(body["emoji"], "fire")
        self.assertEqual(body["reacts"][0]["count"], 1)
        self.assertTrue(body["reacts"][0]["me"])
        self.assertEqual(body["reacts"][0]["people"][0]["name"], "Alex")

        self._react(self.mate, "fire")
        feed = self.client.get("/api/drill-instructor/message/").json()
        activity = next(row for row in feed if row["id"] == self.activity.id)
        by_emoji = {row["emoji"]: row for row in activity["reacts"]}
        self.assertEqual(by_emoji["fire"]["count"], 2)
        self.assertTrue(by_emoji["fire"]["me"])
        names = {p["name"] for p in by_emoji["fire"]["people"]}
        self.assertEqual(names, {"Alex", "Mia"})

    def test_same_emoji_toggles_off(self):
        self._react(self.athlete, "volt")
        response = self._react(self.athlete, "volt")
        self.assertFalse(response.json()["on"])
        self.assertEqual(response.json()["reacts"], [])

    def test_switching_stamp_replaces_the_old_one(self):
        self._react(self.athlete, "fire")
        response = self._react(self.athlete, "goat")
        self.assertTrue(response.json()["on"])
        self.assertEqual(response.json()["emoji"], "goat")
        emojis = [row["emoji"] for row in response.json()["reacts"]]
        self.assertEqual(emojis, ["goat"])
        self.assertTrue(response.json()["reacts"][0]["me"])
        self.client.force_authenticate(self.athlete)
        feed = self.client.get("/api/drill-instructor/message/").json()
        activity = next(row for row in feed if row["id"] == self.activity.id)
        self.assertEqual([row["emoji"] for row in activity["reacts"]], ["goat"])

    def test_push_feed_has_empty_reacts(self):
        self.client.force_authenticate(self.athlete)
        feed = self.client.get("/api/drill-instructor/message/").json()
        push = next(row for row in feed if row["id"] == self.push.id)
        self.assertEqual(push["reacts"], [])

    def test_unknown_emoji_rejected(self):
        response = self._react(self.athlete, "thumbs")
        self.assertEqual(response.status_code, 400)

    def test_not_on_push_messages(self):
        response = self._react(self.athlete, "fire", message=self.push)
        self.assertEqual(response.status_code, 400)

    def test_outsider_gets_404(self):
        response = self._react(self.outsider, "fire")
        self.assertEqual(response.status_code, 404)

    def test_anonymous_gets_401(self):
        response = self.client.post(
            f"/api/drill-instructor/message/{self.activity.id}/react/",
            {"emoji": "fire"}, format="json",
        )
        self.assertEqual(response.status_code, 401)


class PhotoPostTests(TestCase):
    """Participants post pictures into the coach feed; the coach reacts
    asynchronously (post_photo_reaction task); the image itself is only
    served through the authenticated picture endpoint."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        reaction_patcher = mock.patch("drill_instructor.tasks.post_photo_reaction.delay")
        self.addCleanup(reaction_patcher.stop)
        self.reaction_delay = reaction_patcher.start()

        # Photo posts are gated on the configured LLM accepting images -
        # pretend a vision-capable model (the probe itself is covered by
        # its own tests below).
        vision_patcher = mock.patch("drill_instructor.views.check_vision_capability", return_value=True)
        self.addCleanup(vision_patcher.stop)
        vision_patcher.start()

        self._media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._media_tmp.cleanup)
        media_override = override_settings(MEDIA_ROOT=self._media_tmp.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        self.persona = DrillInstructorPersona.objects.create(
            name="Photo Sergeant",
            system_prompt="You are a test sergeant.",
        )
        self.owner = _user("photo-owner@example.com", "Olivia")
        self.athlete = _user("photo-athlete@example.com", "Alex")
        self.outsider = _user("photo-outsider@example.com", "Nina")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Photo Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=self.persona,
        )
        self.client = APIClient()

        reply_patcher = mock.patch("drill_instructor.tasks.post_reply_reaction.delay")
        self.addCleanup(reply_patcher.stop)
        self.reply_delay = reply_patcher.start()

    def _activity_root(self, user=None):
        user = user or self.athlete
        workout = Workout(
            user=user, sport_type="Run",
            start_datetime=timezone.now(), duration=datetime.timedelta(minutes=30),
            distance=5, kcal=300, intensity_category=2,
        )
        workout.save(score=False)
        return DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_ACTIVITY,
            workout=workout, body="Nice work!",
        )

    def _post(self, user, caption="Proof of the hill repeats!", parent=None):
        self.client.force_authenticate(user)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        data = {"image": image, "parent": (parent or self._activity_root(user)).id}
        if caption is not None:
            data["caption"] = caption
        return self.client.post("/api/drill-instructor/message/photo/", data, format="multipart")

    # ---- endpoint permissions & validation ----------------------------

    def test_anonymous_gets_401(self):
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"parent": 1, "image": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 401)

    def test_outsider_gets_404(self):
        root = self._activity_root(self.athlete)
        self.client.force_authenticate(self.outsider)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"parent": root.id, "image": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 404)

    def test_photo_without_parent_or_competition_is_rejected(self):
        self.client.force_authenticate(self.athlete)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"image": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("latest workout", response.json()["parent"])

    def test_standalone_feed_photo_attaches_to_last_own_activity(self):
        own = self._activity_root(self.athlete)
        self.client.force_authenticate(self.athlete)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"competition": self.competition.id, "image": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        message = DrillInstructorMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(message.parent, own)

    def test_photo_on_nudge_or_mention_attaches_to_last_own_activity(self):
        own = self._activity_root(self.athlete)
        push = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PUSH,
            body="Show me the effort, @Alex!",
        )
        response = self._post(self.athlete, parent=push)
        self.assertEqual(response.status_code, 201, response.content)
        message = DrillInstructorMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(message.parent, own)

    def test_photo_on_someone_elses_workout_attaches_to_last_own(self):
        own = self._activity_root(self.athlete)
        their_root = self._activity_root(self.owner)
        response = self._post(self.athlete, parent=their_root)
        self.assertEqual(response.status_code, 201, response.content)
        message = DrillInstructorMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(message.parent, own)
        self.assertNotEqual(message.parent, their_root)

    def test_photo_without_own_activity_is_rejected(self):
        push = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PUSH, body="Show me the effort, @Alex!",
        )
        response = self._post(self.athlete, parent=push)
        self.assertEqual(response.status_code, 400)
        self.assertIn("latest workout", response.json()["parent"])

    def test_photo_always_uses_the_latest_own_activity(self):
        older = self._activity_root(self.athlete)
        DrillInstructorMessage.objects.filter(pk=older.pk).update(
            posted_at=timezone.now() - datetime.timedelta(hours=2)
        )
        newer = self._activity_root(self.athlete)
        response = self._post(self.athlete, parent=older)
        self.assertEqual(response.status_code, 201, response.content)
        message = DrillInstructorMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(message.parent, newer)

    def test_participant_can_post_and_reaction_is_queued(self):
        root = self._activity_root(self.athlete)
        response = self._post(self.athlete, parent=root)
        self.assertEqual(response.status_code, 201, response.content)
        message = DrillInstructorMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(message.kind, DrillInstructorMessage.KIND_PHOTO)
        self.assertEqual(message.parent, root)
        self.assertEqual(message.user, self.athlete)
        self.assertEqual(message.body, "Proof of the hill repeats!")
        self.assertTrue(message.image.name.startswith("message_pics/"))
        self.reply_delay.assert_called_once_with(message.id)
        self.reaction_delay.assert_not_called()

    def test_second_photo_on_same_activity_rejected(self):
        root = self._activity_root(self.athlete)
        first = self._post(self.athlete, parent=root)
        self.assertEqual(first.status_code, 201, first.content)
        second = self._post(self.athlete, parent=root)
        self.assertEqual(second.status_code, 400)
        self.assertIn("already has a photo", second.json()["image"])
        self.assertEqual(
            DrillInstructorMessage.objects.filter(
                kind=DrillInstructorMessage.KIND_PHOTO, parent=root,
            ).count(),
            1,
        )

    def test_photo_adds_ten_points_to_the_activity(self):
        from competition.models import Points
        from competition.scorer import PHOTO_BONUS_POINTS, PHOTO_AWARD_NAME
        from .serializers import DrillInstructorMessageSerializer
        root = self._activity_root(self.athlete)
        before = sum(float(p.points_capped or 0) for p in root.workout.points_set.all())
        response = self._post(self.athlete, parent=root)
        self.assertEqual(response.status_code, 201, response.content)
        bonus = Points.objects.get(workout=root.workout, award__name=PHOTO_AWARD_NAME)
        self.assertEqual(float(bonus.points_capped), float(PHOTO_BONUS_POINTS))
        self.assertEqual(bonus.award.competition_id, self.competition.id)
        payload = DrillInstructorMessageSerializer(root).data
        self.assertEqual(payload["points_capped"], before + PHOTO_BONUS_POINTS)
        photo_row = next(row for row in payload["points_breakdown"] if row["kind"] == "photo")
        self.assertEqual(photo_row["points"], float(PHOTO_BONUS_POINTS))
        # One photo, one bonus — a rejected second post must not double it.
        second = self._post(self.athlete, parent=root)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(
            Points.objects.filter(workout=root.workout, award__name=PHOTO_AWARD_NAME).count(),
            1,
        )

    def test_payload_exposes_image_via_authenticated_url(self):
        response = self._post(self.athlete)
        payload = response.json()
        self.assertIn(f"/api/drill-instructor/message/{payload['id']}/picture/", payload["image"])
        self.assertNotIn("/media/", payload["image"])
        self.assertEqual(payload["author_name"], "Alex")

    def test_caption_optional(self):
        response = self._post(self.athlete, caption=None)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["body"], "")

    def test_caption_too_long(self):
        response = self._post(self.athlete, caption="x" * 501)
        self.assertEqual(response.status_code, 400)

    def test_image_required(self):
        root = self._activity_root(self.athlete)
        self.client.force_authenticate(self.athlete)
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"parent": root.id},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)

    def test_non_image_rejected(self):
        root = self._activity_root(self.athlete)
        self.client.force_authenticate(self.athlete)
        fake = SimpleUploadedFile("evil.png", b"not an image", content_type="text/plain")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"parent": root.id, "image": fake},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)

    def test_post_to_benched_coach_rejected(self):
        self.config.enabled = False
        self.config.save()
        response = self._post(self.athlete)
        self.assertEqual(response.status_code, 400)

    def test_post_rejected_when_model_cant_see(self):
        with mock.patch("drill_instructor.views.check_vision_capability", return_value=False):
            response = self._post(self.athlete)
        self.assertEqual(response.status_code, 400)
        self.assertIn("can't see pictures", response.json()["image"])
        self.assertFalse(DrillInstructorMessage.objects.filter(kind=DrillInstructorMessage.KIND_PHOTO).exists())

    def test_post_throttled(self):
        # The configured daily cap (default 2) is enforced - one more
        # post within 24h is refused.
        from django.conf import settings
        for _ in range(settings.DRILL_MAX_PHOTOS_PER_DAY):
            DrillInstructorMessage.objects.create(
                config=self.config, kind=DrillInstructorMessage.KIND_PHOTO,
                user=self.athlete, body="spam!",
            )
        response = self._post(self.athlete)
        self.assertEqual(response.status_code, 429)

    def test_throttle_counts_only_recent_posts(self):
        old = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PHOTO,
            user=self.athlete, body="yesterday's pic",
        )
        DrillInstructorMessage.objects.filter(pk=old.pk).update(
            posted_at=timezone.now() - datetime.timedelta(hours=25)
        )
        response = self._post(self.athlete)
        self.assertEqual(response.status_code, 201, response.content)

    # ---- feed integration ----------------------------------------------

    def test_activity_message_carries_points_and_order_ribbon(self):
        from django.db.models import Sum
        from competition.models import ActivityGoal, Points
        from .models import DailyOrder
        root = self._activity_root(self.athlete)
        goal = ActivityGoal.objects.create(
            competition=self.competition, name="Minutes", metric="min", goal=30, period="day",
        )
        Points.objects.create(goal=goal, workout=root.workout, points_raw=40, points_capped=32)
        order = DailyOrder.objects.create(
            config=self.config, date=timezone.localdate(),
            kind=DailyOrder.KIND_LOG, brief="Log something.",
        )
        order.completed_by.add(self.athlete)
        self.client.force_authenticate(self.athlete)
        card = self.client.get("/api/drill-instructor/message/").json()[0]
        totals = Points.objects.filter(
            workout=root.workout, goal__competition=self.competition,
        ).aggregate(
            capped=Sum("points_capped"), raw=Sum("points_raw"),
        )
        self.assertEqual(card["id"], root.id)
        self.assertEqual(card["points_capped"], float(totals["capped"]))
        self.assertEqual(card["points_raw"], float(totals["raw"]))
        self.assertGreaterEqual(card["points_capped"], 32.0)
        self.assertTrue(card["order_ribbon"])
        self.assertEqual(card["workout_summary"], "30 min Run · 5.00 km · 300 kcal")
        labels = [row["label"] for row in card["points_breakdown"]]
        self.assertIn("Exercise", labels)
        self.assertIn("Move", labels)
        self.assertIn("Minutes", labels)
        self.assertIn("Photo", labels)
        photo = next(row for row in card["points_breakdown"] if row["kind"] == "photo")
        self.assertEqual(photo["points"], 0.0)
        minutes = next(row for row in card["points_breakdown"] if row["label"] == "Minutes")
        self.assertEqual(minutes["kind"], "goal")
        self.assertEqual(minutes["metric"], "min")
        self.assertEqual(minutes["target"], 30.0)
        self.assertEqual(minutes["period"], "day")
        self.assertEqual(minutes["minutes"], 30)
        self.assertEqual(minutes["sport"], "Run")
        self.assertEqual(minutes["kcal"], 300.0)
        self.assertEqual(minutes["km"], 5.0)
        self.assertIn("sport_factor", minutes)
        self.assertIn("max_per_day", minutes)
        self.assertIn("max_per_week", minutes)
        self.assertIn("min_per_workout", minutes)
        move = next(row for row in card["points_breakdown"] if row["label"] == "Move")
        self.assertEqual(move["kind"], "goal")
        self.assertEqual(move["metric"], "kcal")

    def test_points_breakdown_names_the_daily_cap(self):
        from competition.models import ActivityGoal, Points
        root = self._activity_root(self.athlete)
        goal = ActivityGoal.objects.create(
            competition=self.competition, name="DailyCap", metric="min",
            goal=150, period="week", max_per_day=60,
        )
        Points.objects.filter(goal=goal, workout=root.workout).delete()
        Points.objects.create(goal=goal, workout=root.workout, points_raw=80, points_capped=40)
        self.client.force_authenticate(self.athlete)
        card = self.client.get("/api/drill-instructor/message/").json()[0]
        row = next(item for item in card["points_breakdown"] if item["label"] == "DailyCap")
        self.assertEqual(row["minutes"], 30)
        self.assertEqual(row["sport"], "Run")
        self.assertIsNotNone(row["cap_hit"])
        self.assertEqual(row["cap_hit"]["kind"], "day")
        self.assertEqual(row["cap_hit"]["limit"], 60.0)
        self.assertEqual(row["cap_hit"]["points"], 40.0)

    def test_activity_message_points_ignore_other_competitions(self):
        """Feed badges must match the Board: only this competition's
        goals/awards. A workout scored in two challenges used to sum
        every Points row, so deleting A's goals left B's points on A's
        feed while the Board correctly dropped to 0."""
        from django.db.models import Sum
        from competition.models import ActivityGoal, Points
        root = self._activity_root(self.athlete)
        # Creating the goal scores the workout for THIS competition only.
        own_goal = ActivityGoal.objects.create(
            competition=self.competition, name="Minutes", metric="min", goal=30, period="day",
        )
        other = Competition.objects.create(
            owner=self.owner,
            name="Other Cup",
            start_date=self.competition.start_date,
            end_date=self.competition.end_date,
        )
        # Joining scores the same workout against Other Cup's default goals.
        self.athlete.my_competitions.add(other)
        ActivityGoal.objects.create(
            competition=other, name="Other Minutes", metric="min", goal=30, period="day",
        )

        own_totals = Points.objects.filter(
            workout=root.workout, goal__competition=self.competition,
        ).aggregate(capped=Sum("points_capped"), raw=Sum("points_raw"))
        other_totals = Points.objects.filter(
            workout=root.workout, goal__competition=other,
        ).aggregate(capped=Sum("points_capped"), raw=Sum("points_raw"))
        self.assertGreater(float(own_totals["capped"] or 0), 0)
        self.assertGreater(float(other_totals["capped"] or 0), 0)

        self.client.force_authenticate(self.athlete)
        card = self.client.get(
            f"/api/drill-instructor/message/?competition={self.competition.id}"
        ).json()[0]
        self.assertEqual(card["id"], root.id)
        self.assertEqual(card["points_capped"], float(own_totals["capped"]))
        self.assertEqual(card["points_raw"], float(own_totals["raw"]))
        self.assertNotEqual(card["points_capped"], float(own_totals["capped"]) + float(other_totals["capped"]))

        own_goal.delete()
        card = self.client.get(
            f"/api/drill-instructor/message/?competition={self.competition.id}"
        ).json()[0]
        self.assertEqual(card["points_capped"], 0.0)
        self.assertEqual(card["points_raw"], 0.0)
        self.assertGreater(
            float(Points.objects.filter(workout=root.workout, goal__competition=other)
                  .aggregate(capped=Sum("points_capped"))["capped"] or 0),
            0,
        )

    def test_photo_post_hangs_under_the_workout_in_the_feed(self):
        root = self._activity_root(self.athlete)
        self._post(self.athlete, parent=root)
        self.client.force_authenticate(self.athlete)
        response = self.client.get("/api/drill-instructor/message/")
        results = response.json()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], root.id)
        self.assertEqual(results[0]["kind"], DrillInstructorMessage.KIND_ACTIVITY)
        self.assertEqual(results[0]["workout_user_id"], self.athlete.id)
        self.assertEqual(results[0]["athlete_name"], "Alex")
        self.assertIn("athlete_profile_picture", results[0])
        photo_replies = [r for r in results[0]["replies"] if r["kind"] == DrillInstructorMessage.KIND_PHOTO]
        self.assertEqual(len(photo_replies), 1)
        self.assertEqual(photo_replies[0]["author_name"], "Alex")
        self.assertTrue(photo_replies[0]["image"])
        self.assertIn(f"/message/{photo_replies[0]['id']}/picture/", photo_replies[0]["image"])

    def test_activity_remix_is_backdrop_and_hot_or_not_not_the_original(self):
        # Original stays the feed answer; the coach's edited poster is a
        # sibling reaction used as the activity backdrop and roast card.
        root = self._activity_root(self.athlete)
        self._post(self.athlete, parent=root)
        photo = root.replies.get(kind=DrillInstructorMessage.KIND_PHOTO)
        roast = DrillInstructorMessage(
            config=self.config, kind=DrillInstructorMessage.KIND_REACTION,
            parent=root, user=None, body="I made you a poster.",
        )
        roast.image.save("roast.png", SimpleUploadedFile("roast.png", PNG_1PX, content_type="image/png"))
        roast.save()

        self.client.force_authenticate(self.athlete)
        card = self.client.get("/api/drill-instructor/message/").json()[0]
        originals = [r for r in card["replies"] if r["kind"] == DrillInstructorMessage.KIND_PHOTO]
        remixes = [r for r in card["replies"] if r["is_coach"] and r["image"]]
        self.assertEqual(len(originals), 1)
        self.assertEqual(len(remixes), 1)
        self.assertIn(f"/message/{photo.id}/picture/", originals[0]["image"])
        self.assertIn(f"/message/{roast.id}/picture/", remixes[0]["image"])
        self.assertNotEqual(originals[0]["image"], remixes[0]["image"])

        roasts = self.client.get("/api/drill-instructor/message/roasts/").json()
        self.assertEqual([c["id"] for c in roasts], [roast.id])
        self.assertIn(f"/message/{roast.id}/picture/", roasts[0]["image"])
        self.assertNotIn(f"/message/{photo.id}/picture/", roasts[0]["image"])
        self.assertEqual(roasts[0]["athlete_name"], "Alex")

        hall = self.client.get("/api/drill-instructor/message/hall/").json()
        self.assertEqual(hall[0]["id"], roast.id)
        self.assertEqual(hall[0]["athlete_name"], "Alex")
        self.assertIn(f"/message/{roast.id}/picture/", hall[0]["image"])

    def test_replies_under_photos_use_the_regular_thread(self):
        root = self._activity_root(self.athlete)
        self._post(self.athlete, parent=root)
        self.client.force_authenticate(self.owner)
        response = self.client.post(f"/api/drill-instructor/message/{root.id}/reply/", {"body": "Nice form!"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)

    # ---- photo as a thread reply (Coach page button) -------------------

    def _coach_root(self):
        return DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PUSH, body="Show me the effort!",
        )

    def test_photo_reply_to_own_workout_comment(self):
        root = self._activity_root(self.athlete)
        self.client.force_authenticate(self.athlete)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"parent": root.id, "image": image, "caption": "Like this?"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        message = DrillInstructorMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(message.kind, DrillInstructorMessage.KIND_PHOTO)
        self.assertEqual(message.parent, root)  # thread reply, not a root
        self.assertEqual(message.config, self.config)  # competition comes from the parent
        self.reply_delay.assert_called_once_with(message.id)
        self.reaction_delay.assert_not_called()

    def test_photo_reply_to_child_message_rejected(self):
        root = self._coach_root()
        child = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REPLY,
            parent=root, user=self.athlete, body="first",
        )
        self.client.force_authenticate(self.athlete)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"parent": child.id, "image": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 404)  # children are not reply targets

    def test_photo_reply_outsider_gets_404(self):
        root = self._coach_root()
        self.client.force_authenticate(self.outsider)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"parent": root.id, "image": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 404)

    def test_reply_reaction_task_skips_in_feed_reply_for_photos(self):
        # A workout photo is not a chat turn: no coach bubble in the
        # feed. The remix (when an edit model is on) is the backdrop /
        # hot-or-not card instead.
        from .tasks import post_reply_reaction
        photo_reply = self._photo_message()
        photo_reply.parent = self._coach_root()
        photo_reply.save()
        with mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value=None), \
                mock.patch("drill_instructor.tasks.generate_message") as gen:
            result = post_reply_reaction(photo_reply.id)
        gen.assert_not_called()
        self.assertIsNone(result["reaction_id"])
        self.assertIsNone(result["roast_id"])
        self.assertFalse(
            DrillInstructorMessage.objects.filter(
                parent=photo_reply.parent, kind=DrillInstructorMessage.KIND_REACTION,
            ).exists()
        )

    def test_photo_reply_earns_the_roast_remix(self):
        # The Coach page's photo button always replies to the coach's
        # latest message - the reply pipeline must roast those photos
        # too, or Coach-page uploads never reach the hot-or-not box.
        from .tasks import post_reply_reaction
        photo_reply = self._photo_message()
        photo_reply.parent = self._coach_root()
        photo_reply.save()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value="grok-imagine-image"), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - framed it!", None)), \
                mock.patch("drill_instructor.tasks.generate_roast_image", return_value=(PNG_1PX, None)) as roast:
            result = post_reply_reaction(photo_reply.id)
        self.assertIsNotNone(result["roast_id"])
        roast_msg = DrillInstructorMessage.objects.get(pk=result["roast_id"])
        self.assertEqual(roast_msg.kind, DrillInstructorMessage.KIND_REACTION)
        self.assertEqual(roast_msg.parent, photo_reply.parent)  # hangs under the thread ROOT, not the reply
        self.assertIsNone(roast_msg.user)
        self.assertTrue(roast_msg.image)
        roast_args = roast.call_args[0]  # positional: (image_path, prompt, model)
        self.assertEqual(roast_args[0], photo_reply.image.path)
        self.assertEqual(roast_args[2], "grok-imagine-image")

    def test_photo_reply_roasts_without_chat_vision(self):
        from .tasks import post_reply_reaction
        photo_reply = self._photo_message()
        photo_reply.parent = self._coach_root()
        photo_reply.save()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=False), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value="grok-imagine-image"), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - framed it!", None)), \
                mock.patch("drill_instructor.tasks.generate_roast_image", return_value=(PNG_1PX, None)):
            result = post_reply_reaction(photo_reply.id)
        self.assertIsNotNone(result["roast_id"])

    def test_photo_reply_roast_includes_workout_stats_and_setting(self):
        from .tasks import post_reply_reaction
        workout = Workout(
            user=self.athlete, sport_type="Run",
            start_datetime=timezone.now(), duration=datetime.timedelta(minutes=45),
            distance=5, kcal=420, intensity_category=2,
        )
        workout.save(score=False)
        self.persona.description = "A smoky boxing gym at midnight."
        self.persona.save()
        root = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_ACTIVITY,
            body="Nice work!", workout=workout,
        )
        photo_reply = self._photo_message()
        photo_reply.parent = root
        photo_reply.save()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value="grok-imagine-image"), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - framed it!", None)), \
                mock.patch("drill_instructor.tasks.generate_roast_image", return_value=(PNG_1PX, None)) as roast:
            post_reply_reaction(photo_reply.id)
        prompt = roast.call_args[0][1]
        self.assertIn("A smoky boxing gym at midnight.", prompt)
        self.assertIn("45 min Run", prompt)
        self.assertIn("5.00 km", prompt)
        self.assertIn("420 kcal", prompt)
        self.assertIn("WORKOUT IN THE SCENE", prompt)

    def test_photo_reply_no_roast_without_edit_model(self):
        from .tasks import post_reply_reaction
        photo_reply = self._photo_message()
        photo_reply.parent = self._coach_root()
        photo_reply.save()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value=None), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - noted!", None)):
            result = post_reply_reaction(photo_reply.id)
        self.assertIsNone(result["roast_id"])

    # ---- the picture endpoint ------------------------------------------

    def _photo_message(self):
        message = DrillInstructorMessage(
            config=self.config, kind=DrillInstructorMessage.KIND_PHOTO,
            user=self.athlete, body="pic",
        )
        message.image.save("photo.png", SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png"))
        message.save()
        return message

    def test_picture_member_gets_internal_redirect(self):
        message = self._photo_message()
        self.client.force_authenticate(self.owner)
        response = self.client.get(f"/api/drill-instructor/message/{message.id}/picture/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["X-Accel-Redirect"], f"/protected-media/{message.image.name}")
        self.assertIn("private", response["Cache-Control"])
        self.assertIn("no-store", response["Cache-Control"])
        self.assertIn("noindex", response["X-Robots-Tag"])
        self.assertEqual(response["Cross-Origin-Resource-Policy"], "same-origin")

    def test_picture_outsider_gets_404(self):
        message = self._photo_message()
        self.client.force_authenticate(self.outsider)
        response = self.client.get(f"/api/drill-instructor/message/{message.id}/picture/")
        self.assertEqual(response.status_code, 404)

    def test_picture_anonymous_gets_401(self):
        message = self._photo_message()
        response = self.client.get(f"/api/drill-instructor/message/{message.id}/picture/")
        self.assertEqual(response.status_code, 401)

    # ---- the coach's reaction task --------------------------------------

    def test_photo_reaction_task_creates_coach_reaction(self):
        from .tasks import post_photo_reaction
        photo = self._photo_message()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value=None), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - photo proof logged!", None)) as gen:
            result = post_photo_reaction(photo.id)
        reaction = DrillInstructorMessage.objects.get(pk=result["reaction_id"])
        self.assertEqual(reaction.kind, DrillInstructorMessage.KIND_REACTION)
        self.assertEqual(reaction.parent, photo)
        self.assertIsNone(reaction.user)
        _, kwargs = gen.call_args
        self.assertIn("@Alex", kwargs["user_prompt"])
        self.assertIn("pic", kwargs["user_prompt"])
        # A vision-capable model gets the actual picture attached.
        self.assertEqual(kwargs["image_path"], photo.image.path)
        self.assertIn("CAN see it", kwargs["user_prompt"])
        self.assertIsNone(result["roast_id"])  # no image-edit model probed

    # ---- the roast remix -----------------------------------------------

    def test_roast_posts_remixed_image_as_second_reaction(self):
        from .tasks import post_photo_reaction
        photo = self._photo_message()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value="dall-e-2"), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - framed it!", None)), \
                mock.patch("drill_instructor.tasks.generate_roast_image", return_value=(PNG_1PX, None)) as roast:
            result = post_photo_reaction(photo.id)
        self.assertIsNotNone(result["roast_id"])
        roast_msg = DrillInstructorMessage.objects.get(pk=result["roast_id"])
        self.assertEqual(roast_msg.kind, DrillInstructorMessage.KIND_REACTION)
        self.assertEqual(roast_msg.parent, photo)
        self.assertIsNone(roast_msg.user)
        self.assertTrue(roast_msg.image)  # the remixed poster
        self.assertIn("@Alex", roast_msg.body)
        roast_args = roast.call_args[0]  # positional: (image_path, prompt, model)
        self.assertEqual(roast_args[0], photo.image.path)
        self.assertEqual(roast_args[2], "dall-e-2")  # probed model passed through

    def test_roast_failure_still_posts_the_text_reaction(self):
        from .tasks import post_photo_reaction
        photo = self._photo_message()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value="dall-e-2"), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - noted!", None)), \
                mock.patch("drill_instructor.tasks.generate_roast_image", return_value=(None, "quota exhausted")):
            result = post_photo_reaction(photo.id)
        self.assertIsNone(result["roast_id"])
        self.assertIsNotNone(result["reaction_id"])  # text always lands
        self.config.refresh_from_db()
        self.assertIn("quota exhausted", self.config.last_error)

    def test_roast_still_runs_when_chat_model_cannot_see(self):
        # The editor gets the pixels itself; a cold vision probe must not
        # skip the remix (photos hang under workout comments now).
        from .tasks import post_photo_reaction
        photo = self._photo_message()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=False), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value="grok-imagine-image"), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - noted!", None)), \
                mock.patch("drill_instructor.tasks.generate_roast_image", return_value=(PNG_1PX, None)):
            result = post_photo_reaction(photo.id)
        self.assertIsNotNone(result["roast_id"])

    def test_reaction_image_served_through_the_picture_endpoint(self):
        photo = self._photo_message()
        roast_msg = DrillInstructorMessage(
            config=self.config, kind=DrillInstructorMessage.KIND_REACTION,
            parent=photo, user=None, body="roasted",
        )
        roast_msg.image.save("roast.png", SimpleUploadedFile("roast.png", PNG_1PX, content_type="image/png"))
        roast_msg.save()
        self.client.force_authenticate(self.owner)
        response = self.client.get(f"/api/drill-instructor/message/{roast_msg.id}/picture/")
        self.assertEqual(response.status_code, 200)  # child message, not a root
        self.client.force_authenticate(self.outsider)
        response = self.client.get(f"/api/drill-instructor/message/{roast_msg.id}/picture/")
        self.assertEqual(response.status_code, 404)

    def test_photo_reaction_task_text_only_when_model_cant_see(self):
        from .tasks import post_photo_reaction
        photo = self._photo_message()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=False), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - nice one!", None)) as gen:
            post_photo_reaction(photo.id)
        _, kwargs = gen.call_args
        self.assertIsNone(kwargs["image_path"])
        self.assertIn("cannot see the picture", kwargs["user_prompt"])

    def test_photo_reaction_task_retries_text_only_when_image_call_fails(self):
        from .tasks import post_photo_reaction
        photo = self._photo_message()
        calls = []

        def fake_generate(**kwargs):
            calls.append(kwargs)
            if kwargs.get("image_path"):
                return None, "provider rejected the image"
            return "@Alex - noted the caption!", None

        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value=None), \
                mock.patch("drill_instructor.tasks.generate_message", side_effect=fake_generate):
            result = post_photo_reaction(photo.id)
        reaction = DrillInstructorMessage.objects.get(pk=result["reaction_id"])
        self.assertEqual(reaction.body, "@Alex - noted the caption!")
        self.assertEqual(len(calls), 2)
        self.assertIsNone(calls[1].get("image_path"))  # text-only retry

    def test_photo_reaction_task_static_fallback_on_llm_outage(self):
        from .tasks import post_photo_reaction
        photo = self._photo_message()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value=None), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=(None, "outage")):
            result = post_photo_reaction(photo.id)
        reaction = DrillInstructorMessage.objects.get(pk=result["reaction_id"])
        self.assertIn("Photo Sergeant", reaction.body)
        self.assertIn("@Alex", reaction.body)

    def test_photo_reaction_task_ignores_non_photo_messages(self):
        from .tasks import post_photo_reaction
        root = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PUSH, body="Move!",
        )
        result = post_photo_reaction(root.id)
        self.assertEqual(result.get("skipped"), "not_a_photo_post")


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class VisionCapabilityProbeTests(TestCase):
    """The photo feature gates on a live probe of the configured LLM:
    one tiny image completion decides whether the model can see. The
    answer is cached per endpoint+model; transient failures expire fast,
    definitive 400s stick for a day."""

    def setUp(self):
        self.settings_override = override_settings(
            OPENAI_API_KEY="test-key",
            LLM_PROVIDER="custom",
            LLM_BASE_URL="https://llm.example.com/v1",
            LLM_MODEL="some-model",
        )
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        from site_settings.models import SiteSettings
        SiteSettings.get_solo()  # ensure the resolver has a row
        # The probe answer is cached per endpoint+model - every test
        # needs a clean slate or a cached result would skip the mock.
        from django.core.cache import cache
        cache.clear()

    def _run_probe(self, side_effect=None):
        from . import llm_client
        client = mock.Mock()
        create = client.chat.completions.create
        if side_effect is not None:
            create.side_effect = side_effect
        with mock.patch.object(llm_client, "_resolved_client", return_value=(client, {
            "provider": "custom",
            "api_key": "test-key",
            "base_url": "https://llm.example.com/v1",
            "model": "some-model",
        }, None)):
            first = llm_client.check_vision_capability()
            second = llm_client.check_vision_capability()
        return first, second, create

    def test_no_api_key_means_no_vision(self):
        from . import llm_client
        with mock.patch.object(llm_client, "_resolved_client", return_value=(None, {}, "no key")):
            self.assertFalse(llm_client.check_vision_capability())

    def test_successful_probe_means_vision_and_is_cached(self):
        first, second, create = self._run_probe()
        self.assertTrue(first)
        self.assertTrue(second)
        create.assert_called_once()  # second call served from cache

    def test_400_means_no_vision_and_is_cached(self):
        class FakeBadRequest(Exception):
            status_code = 400

        first, second, create = self._run_probe(side_effect=FakeBadRequest("image input not supported"))
        self.assertFalse(first)
        self.assertFalse(second)
        create.assert_called_once()

    def test_probe_sends_an_image_content_part(self):
        _, _, create = self._run_probe()
        content = create.call_args[1]["messages"][0]["content"]
        self.assertEqual(content[0]["type"], "text")
        self.assertEqual(content[1]["type"], "image_url")
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/png;base64,"))


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ImageEditCapabilityProbeTests(TestCase):
    """The roast remix gates on a live probe of the images.edit endpoint:
    the configured chat model is tried first, then the provider's known
    image models; the first working model name is cached and returned."""

    def setUp(self):
        from django.core.cache import cache
        cache.clear()  # probe answers are cached per endpoint+model
        # The dedicated image endpoint must not leak between tests.
        no_image_cfg = override_settings(
            LLM_IMAGE_BASE_URL="", LLM_IMAGE_MODEL="", LLM_IMAGE_API_KEY="",
        )
        no_image_cfg.enable()
        self.addCleanup(no_image_cfg.disable)

    def _config(self, provider="custom"):
        return {
            "provider": provider,
            "api_key": "test-key",
            "base_url": "https://llm.example.com/v1",
            "model": "chat-model",
        }

    def _run(self, client, config):
        from . import llm_client
        with mock.patch.object(llm_client, "_resolved_client", return_value=(client, config, None)):
            return llm_client.check_image_edit_capability()

    def test_no_api_key_means_no_edit_capability(self):
        from . import llm_client
        with mock.patch.object(llm_client, "_resolved_client", return_value=(None, {}, "no key")):
            self.assertIsNone(llm_client.check_image_edit_capability())

    def test_configured_model_wins_when_it_can_edit(self):
        client = mock.Mock()
        self.assertEqual(self._run(client, self._config()), "chat-model")
        client.images.edit.assert_called_once()

    def test_openai_fallback_models_are_tried(self):
        class FakeBadRequest(Exception):
            status_code = 400

        client = mock.Mock()
        client.images.edit.side_effect = [FakeBadRequest("chat model can't edit"), mock.Mock()]
        self.assertEqual(self._run(client, self._config(provider="openai")), "gpt-image-1")
        self.assertEqual(client.images.edit.call_count, 2)

    def test_no_capable_model_caches_the_negative(self):
        class FakeBadRequest(Exception):
            status_code = 400

        client = mock.Mock()
        client.images.edit.side_effect = FakeBadRequest("nope")
        self.assertIsNone(self._run(client, self._config()))
        self.assertIsNone(self._run(client, self._config()))  # cached
        client.images.edit.assert_called_once()  # custom provider: only the chat model itself

    def test_transient_failure_retries_soon(self):
        client = mock.Mock()
        client.images.edit.side_effect = ConnectionError("provider down")
        self.assertIsNone(self._run(client, self._config()))

    # ---- dedicated image endpoint (LLM_IMAGE_*) -------------------------

    @override_settings(
        LLM_IMAGE_BASE_URL="https://images.example.com/v1",
        LLM_IMAGE_MODEL="image-model",
        LLM_IMAGE_API_KEY="image-key",
        OPENAI_API_KEY="chat-key",
        LLM_PROVIDER="custom",
        LLM_BASE_URL="https://chat.example.com/v1",
        LLM_MODEL="chat-model",
    )
    def test_dedicated_image_endpoint_is_used_and_chat_endpoint_untouched(self):
        from . import llm_client
        # _safe_base_url does real DNS - example.com doesn't resolve in tests.
        with mock.patch.object(llm_client, "_resolved_client", side_effect=AssertionError("chat endpoint must not be probed")), \
                mock.patch.object(llm_client, "_safe_base_url", side_effect=lambda url: url), \
                mock.patch("openai.OpenAI") as openai_cls:
            client = openai_cls.return_value
            result = llm_client.check_image_edit_capability()
        self.assertEqual(result, "image-model")
        # Client built against the IMAGE endpoint with the IMAGE key...
        _, kwargs = openai_cls.call_args
        self.assertEqual(kwargs["base_url"], "https://images.example.com/v1")
        self.assertEqual(kwargs["api_key"], "image-key")
        # ...and only its configured model is probed.
        self.assertEqual(client.images.edit.call_args[1]["model"], "image-model")

    @override_settings(
        LLM_IMAGE_BASE_URL="https://images.example.com/v1",
        LLM_IMAGE_MODEL="image-model",
        LLM_IMAGE_API_KEY="",  # falls back to the main key
        OPENAI_API_KEY="chat-key",
        LLM_PROVIDER="custom",
        LLM_BASE_URL="",
        LLM_MODEL="chat-model",
    )
    def test_image_key_falls_back_to_main_api_key(self):
        from . import llm_client
        with mock.patch.object(llm_client, "_safe_base_url", side_effect=lambda url: url), \
                mock.patch("openai.OpenAI") as openai_cls:
            llm_client.check_image_edit_capability()
        self.assertEqual(openai_cls.call_args[1]["api_key"], "chat-key")

    @override_settings(
        LLM_IMAGE_BASE_URL="https://images.example.com/v1",
        LLM_IMAGE_MODEL="",  # base_url without model = not configured
    )
    def test_partial_image_config_is_ignored(self):
        from . import llm_client
        self.assertIsNone(llm_client._image_endpoint_config())

    @override_settings(
        LLM_IMAGE_BASE_URL="http://169.254.169.254/v1",  # SSRF guard applies here too
        LLM_IMAGE_MODEL="image-model",
    )
    def test_private_image_endpoint_rejected(self):
        from . import llm_client
        client, model, candidates, style = llm_client._image_client()
        self.assertIsNone(client)
        self.assertEqual(candidates, [])

    @override_settings(
        LLM_IMAGE_BASE_URL="https://api.x.ai/v1",
        LLM_IMAGE_MODEL="grok-imagine-image",
        LLM_IMAGE_API_KEY="xai-key",
    )
    def test_xai_endpoint_gets_json_client(self):
        from . import llm_client
        with mock.patch.object(llm_client, "_safe_base_url", side_effect=lambda url: url):
            client, model, candidates, style = llm_client._image_client()
        self.assertEqual(style, "xai")
        self.assertEqual(model, "grok-imagine-image")
        self.assertEqual(candidates, ["grok-imagine-image"])
        self.assertEqual(client.base_url, "https://api.x.ai/v1")
        self.assertEqual(client.api_key, "xai-key")

    def test_xai_edit_posts_json_not_multipart(self):
        """xAI 415s the OpenAI SDK's multipart edit call - the JSON body
        with a base64 data-URI image is the working wire format."""
        from . import llm_client
        client = llm_client._XaiImageClient("https://api.x.ai/v1", "xai-key", 30)
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {"data": [{"b64_json": base64.b64encode(PNG_1PX).decode()}]}
        with mock.patch("requests.post", return_value=resp) as post:
            result = llm_client._images_edit(client, "xai", "grok-imagine-image", PNG_1PX, "roast it", 30)
        _, kwargs = post.call_args
        self.assertEqual(kwargs["json"]["model"], "grok-imagine-image")
        self.assertTrue(kwargs["json"]["image"]["url"].startswith("data:image/png;base64,"))
        self.assertNotIn("files", kwargs)  # never multipart
        payload, error = llm_client._extract_image_payload(result)
        self.assertIsNone(error)
        self.assertEqual(payload, PNG_1PX)

    def test_xai_edit_sends_portrait_as_second_image(self):
        from . import llm_client
        client = llm_client._XaiImageClient("https://api.x.ai/v1", "xai-key", 30)
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {"data": [{"b64_json": base64.b64encode(PNG_1PX).decode()}]}
        with mock.patch("requests.post", return_value=resp) as post:
            llm_client._images_edit(
                client, "xai", "grok-imagine-image", PNG_1PX, "face lock", 30,
                extra_images=[PNG_1PX],
            )
        image = post.call_args[1]["json"]["image"]
        self.assertIsInstance(image, list)
        self.assertEqual(len(image), 2)
        self.assertTrue(image[0]["url"].startswith("data:image/png;base64,"))
        self.assertTrue(image[1]["url"].startswith("data:image/png;base64,"))

    def test_xai_edit_400_carries_status_code(self):
        from . import llm_client
        client = llm_client._XaiImageClient("https://api.x.ai/v1", "xai-key", 30)
        resp = mock.Mock(status_code=400)
        with mock.patch("requests.post", return_value=resp):
            with self.assertRaises(Exception) as ctx:
                llm_client._images_edit(client, "xai", "grok-imagine-image", PNG_1PX, "roast it", 30)
        self.assertEqual(ctx.exception.status_code, 400)


class RoastImagePromptTests(TestCase):
    """build_roast_image_prompt: hardcoded coach-in-scene remix with
    optional face lock and workout-stat overlay."""

    def _build(self, **kwargs):
        from .llm_client import build_roast_image_prompt
        defaults = {"persona_name": "Roast Master", "persona_description": "A smoky boxing gym at midnight."}
        defaults.update(kwargs)
        return build_roast_image_prompt(**defaults)

    def test_setting_comes_from_persona_description(self):
        prompt = self._build()
        self.assertIn("Roast Master", prompt)
        self.assertIn("A smoky boxing gym at midnight.", prompt)
        self.assertIn("COACH BRIEFING", prompt)
        self.assertIn("INTERPRET their setting", prompt)
        self.assertIn("world of coach", prompt)

    def test_face_lock_when_portrait_is_present(self):
        prompt = self._build(has_coach_portrait=True)
        self.assertIn("FACE LOCK", prompt)
        self.assertIn("IMAGE 2", prompt)
        self.assertNotIn("no portrait reference", prompt)

    def test_invents_look_when_no_portrait(self):
        prompt = self._build(has_coach_portrait=False)
        self.assertIn("no portrait reference", prompt)
        self.assertNotIn("FACE LOCK", prompt)

    def test_workout_stats_are_painted_on_the_picture(self):
        prompt = self._build(workout_summary="45 min Run · 5.00 km · 420 kcal")
        self.assertIn("WORKOUT IN THE SCENE", prompt)
        self.assertIn("tattoo", prompt)
        self.assertIn("45 min Run · 5.00 km · 420 kcal", prompt)

    def test_no_stats_omits_overlay(self):
        prompt = self._build()
        self.assertNotIn("WORKOUT IN THE SCENE", prompt)

    def test_caption_is_optional_exact_text(self):
        with_caption = self._build(caption="leg day!")
        self.assertIn('caption spelled EXACTLY: "leg day!"', with_caption)
        without = self._build()
        self.assertIn("Do not invent extra slogans", without)


class RoastImageGenerationTests(TestCase):
    """generate_roast_image: edit call shape, b64 + URL result handling,
    and the dall-e-2 square-PNG normalisation."""

    def setUp(self):
        # The dedicated image endpoint must not leak in from the env.
        no_image_cfg = override_settings(
            LLM_IMAGE_BASE_URL="", LLM_IMAGE_MODEL="", LLM_IMAGE_API_KEY="",
        )
        no_image_cfg.enable()
        self.addCleanup(no_image_cfg.disable)

    def _client(self, b64=None, url=None):
        client = mock.Mock()
        datum = mock.Mock()
        datum.b64_json = base64.b64encode(b64).decode() if b64 else None
        datum.url = url
        client.images.edit.return_value = mock.Mock(data=[datum])
        return client

    def _photo_file(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        tmp.write(PNG_1PX)
        tmp.flush()
        self.addCleanup(tmp.close)
        return tmp.name

    def _generate(self, client, model="m", style="openai"):
        from . import llm_client
        with mock.patch.object(llm_client, "_image_client", return_value=(client, model, [model], style)):
            return llm_client.generate_roast_image(self._photo_file(), "roast it", model)

    def test_b64_result_returned_as_bytes(self):
        client = self._client(b64=PNG_1PX)
        data, error = self._generate(client)
        self.assertIsNone(error)
        self.assertEqual(data, PNG_1PX)
        kwargs = client.images.edit.call_args[1]
        self.assertEqual(kwargs["model"], "m")
        self.assertEqual(kwargs["prompt"], "roast it")

    def _png_get_resp(self, body=PNG_1PX):
        resp = mock.Mock()
        resp.headers = {"Content-Type": "image/png"}
        resp.status_code = 200
        resp.is_redirect = False
        resp.iter_content = lambda chunk_size=None: [body]
        resp.raise_for_status = lambda: None
        resp.close = lambda: None
        return resp

    def test_url_result_is_downloaded(self):
        from . import llm_client
        client = self._client(url="https://img.example.com/roast.png")
        resp = self._png_get_resp()
        with mock.patch.object(llm_client, "_safe_outbound_url", side_effect=lambda url, **kw: url), \
                mock.patch("requests.get", return_value=resp):
            data, error = self._generate(client)
        self.assertIsNone(error)
        self.assertEqual(data, PNG_1PX)

    def test_dalle2_gets_a_square_1024_png(self):
        client = self._client(b64=PNG_1PX)
        self._generate(client, model="dall-e-2")
        sent = client.images.edit.call_args[1]["image"]
        from io import BytesIO

        from PIL import Image
        with Image.open(BytesIO(sent)) as img:
            self.assertEqual(img.format, "PNG")
            self.assertEqual(img.size, (1024, 1024))

    def test_edit_failure_returns_reason(self):
        client = mock.Mock()
        client.images.edit.side_effect = RuntimeError("safety filter")
        data, error = self._generate(client)
        self.assertIsNone(data)
        self.assertIn("safety filter", error)

    def test_no_image_endpoint_means_clean_skip(self):
        from . import llm_client
        with mock.patch.object(llm_client, "_image_client", return_value=(None, None, [], None)):
            data, error = llm_client.generate_roast_image(self._photo_file(), "roast it", "m")
        self.assertIsNone(data)
        self.assertIn("no image-edit endpoint", error)

    def test_xai_style_edit_roundtrip(self):
        from . import llm_client
        client = llm_client._XaiImageClient("https://api.x.ai/v1", "xai-key", 180)
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {"data": [{"b64_json": base64.b64encode(PNG_1PX).decode()}]}
        with mock.patch("requests.post", return_value=resp) as post:
            data, error = self._generate(client, model="grok-imagine-image", style="xai")
        self.assertIsNone(error)
        self.assertEqual(data, PNG_1PX)
        self.assertEqual(post.call_args[1]["timeout"], 180)  # real edits take long

    def test_xai_url_result_is_downloaded(self):
        from . import llm_client
        client = llm_client._XaiImageClient("https://api.x.ai/v1", "xai-key", 180)
        post_resp = mock.Mock(status_code=200)
        post_resp.json.return_value = {"data": [{"url": "https://img.example.com/roast.png"}]}
        get_resp = mock.Mock()
        get_resp.headers = {"Content-Type": "image/png"}
        get_resp.status_code = 200
        get_resp.is_redirect = False
        get_resp.iter_content = lambda chunk_size=None: [PNG_1PX]
        get_resp.raise_for_status = lambda: None
        get_resp.close = lambda: None
        with mock.patch.object(llm_client, "_safe_outbound_url", side_effect=lambda url, **kw: url), \
                mock.patch("requests.post", return_value=post_resp), \
                mock.patch("requests.get", return_value=get_resp):
            data, error = self._generate(client, model="grok-imagine-image", style="xai")
        self.assertIsNone(error)
        self.assertEqual(data, PNG_1PX)

    def test_image_url_to_loopback_is_rejected(self):
        from . import llm_client
        data, error = llm_client._fetch_capped_bytes("http://127.0.0.1/secret", 1024)
        self.assertIsNone(data)
        self.assertEqual(error, "image URL rejected")

    def test_image_url_to_link_local_is_rejected(self):
        from . import llm_client
        data, error = llm_client._fetch_capped_bytes("http://169.254.169.254/latest/meta-data/", 1024)
        self.assertIsNone(data)
        self.assertEqual(error, "image URL rejected")

    def test_image_download_is_size_capped_without_buffering_all(self):
        from . import llm_client
        resp = mock.Mock()
        resp.headers = {"Content-Type": "image/png"}
        resp.status_code = 200
        resp.is_redirect = False
        resp.iter_content = lambda chunk_size=None: [b"x" * 100, b"y" * 100]
        resp.raise_for_status = lambda: None
        resp.close = lambda: None
        with mock.patch.object(llm_client, "_safe_outbound_url", side_effect=lambda url, **kw: url), \
                mock.patch("requests.get", return_value=resp):
            data, error = llm_client._fetch_capped_bytes("https://cdn.example/a.png", 150)
        self.assertIsNone(data)
        self.assertEqual(error, "generated image too large")

    def test_redirect_to_private_host_is_rejected(self):
        from . import llm_client
        redir = mock.Mock()
        redir.status_code = 302
        redir.is_redirect = True
        redir.headers = {"Location": "http://127.0.0.1/ssrf"}
        redir.close = lambda: None
        with mock.patch.object(
            llm_client, "_safe_outbound_url",
            side_effect=lambda url, **kw: None if "127.0.0.1" in url else url,
        ), mock.patch("requests.get", return_value=redir):
            data, error = llm_client._fetch_capped_bytes("https://cdn.example/a.png", 1024)
        self.assertIsNone(data)
        self.assertEqual(error, "image URL rejected")


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class CapabilityCacheReadTests(TestCase):
    """The config serializer never probes synchronously: on a cold cache
    it answers False and queues ONE background probe; a warm cache is
    served directly."""

    def setUp(self):
        from django.core.cache import cache
        cache.clear()

    def _flags(self):
        from .models import DrillInstructorConfig
        from .serializers import DrillInstructorConfigSerializer
        config = DrillInstructorConfig()  # unsaved - the flags don't touch the row
        serializer = DrillInstructorConfigSerializer(config)
        return serializer.data["vision_capable"], serializer.data["image_edit_capable"]

    @override_settings(OPENAI_API_KEY="test-key", LLM_PROVIDER="custom", LLM_BASE_URL="https://llm.example.com/v1", LLM_MODEL="m")
    def test_cold_cache_answers_false_and_queues_one_probe(self):
        with mock.patch("drill_instructor.tasks.probe_llm_capabilities.delay") as probe:
            self.assertEqual(self._flags(), (False, False))
            self.assertEqual(self._flags(), (False, False))
        probe.assert_called_once()  # throttled by the marker

    @override_settings(OPENAI_API_KEY="test-key", LLM_PROVIDER="custom", LLM_BASE_URL="https://llm.example.com/v1", LLM_MODEL="m")
    def test_warm_cache_is_served_without_probing(self):
        from django.core.cache import cache
        from . import llm_client
        from site_settings.models import resolve_llm_settings

        cache.set(llm_client._vision_cache_key(resolve_llm_settings()), True, 60)
        cache.set(llm_client._image_cache_key(), "some-model", 60)
        with mock.patch("drill_instructor.tasks.probe_llm_capabilities.delay") as probe:
            self.assertEqual(self._flags(), (True, True))
        probe.assert_not_called()

    @override_settings(OPENAI_API_KEY="")
    def test_no_api_key_means_false_without_probe(self):
        with mock.patch("drill_instructor.tasks.probe_llm_capabilities.delay") as probe:
            self.assertEqual(self._flags(), (False, False))
        probe.assert_not_called()


class GenerateMessageImageTests(TestCase):
    """generate_message attaches the local picture as a base64 data-URL
    content part when image_path is given (the provider can't reach our
    authenticated media endpoints)."""

    def test_image_becomes_a_multimodal_content_part(self):
        from . import llm_client
        client = mock.Mock()
        client.chat.completions.create.return_value = mock.Mock(
            choices=[mock.Mock(message=mock.Mock(content="Nice shot!"))]
        )
        with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
            tmp.write(PNG_1PX)
            tmp.flush()
            with mock.patch.object(llm_client, "_resolved_client", return_value=(client, {"provider": "custom", "model": "m", "base_url": None}, None)):
                body, error = llm_client.generate_message(
                    system_prompt="You are a coach.",
                    user_prompt="React to this photo.",
                    image_path=tmp.name,
                )
        self.assertIsNone(error)
        self.assertEqual(body, "Nice shot!")
        content = client.chat.completions.create.call_args[1]["messages"][1]["content"]
        self.assertEqual(content[0], {"type": "text", "text": "React to this photo."})
        self.assertEqual(content[1]["type"], "image_url")
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/png;base64,"))

    def test_missing_image_falls_back_to_plain_text(self):
        from . import llm_client
        client = mock.Mock()
        client.chat.completions.create.return_value = mock.Mock(
            choices=[mock.Mock(message=mock.Mock(content="Caption it is!"))]
        )
        with mock.patch.object(llm_client, "_resolved_client", return_value=(client, {"provider": "custom", "model": "m", "base_url": None}, None)):
            body, error = llm_client.generate_message(
                system_prompt="You are a coach.",
                user_prompt="React to this photo.",
                image_path="/nonexistent/photo.png",
            )
        self.assertIsNone(error)
        content = client.chat.completions.create.call_args[1]["messages"][1]["content"]
        self.assertIsInstance(content, str)  # no image part attached


class RoastVoteTests(TestCase):
    """The Coach page's hot-or-not swipe box: roast cards are the coach's
    image reactions across the user's competitions; every member gets one
    vote per card (a second vote is refused)."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self._media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._media_tmp.cleanup)
        media_override = override_settings(MEDIA_ROOT=self._media_tmp.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        self.persona = DrillInstructorPersona.objects.create(
            name="Roast Sergeant", system_prompt="You roast.",
        )
        self.owner = _user("roast-owner@example.com", "Olivia")
        self.athlete = _user("roast-athlete@example.com", "Alex")
        self.outsider = _user("roast-outsider@example.com", "Nina")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner, name="Roast Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition, enabled=True, persona=self.persona,
        )
        self.photo = DrillInstructorMessage(
            config=self.config, kind=DrillInstructorMessage.KIND_PHOTO,
            user=self.athlete, body="proof",
        )
        self.photo.image.save("p.png", SimpleUploadedFile("p.png", PNG_1PX, content_type="image/png"))
        self.photo.save()
        self.roast = DrillInstructorMessage(
            config=self.config, kind=DrillInstructorMessage.KIND_REACTION,
            parent=self.photo, user=None, body="I made you a poster.",
        )
        self.roast.image.save("r.png", SimpleUploadedFile("r.png", PNG_1PX, content_type="image/png"))
        self.roast.save()
        self.client = APIClient()

    # ---- the card listing ----------------------------------------------

    def test_roasts_lists_only_image_reactions_for_members(self):
        # Noise that must NOT appear: the photo post itself, text-only
        # reactions, and coach messages without an image.
        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REACTION,
            parent=self.photo, user=None, body="text only",
        )
        self.client.force_authenticate(self.athlete)
        response = self.client.get("/api/drill-instructor/message/roasts/")
        self.assertEqual(response.status_code, 200)
        cards = response.json()
        self.assertEqual([c["id"] for c in cards], [self.roast.id])
        card = cards[0]
        self.assertEqual(card["athlete_name"], "Alex")
        self.assertEqual(card["persona_name"], "Roast Sergeant")
        self.assertEqual(card["competition_name"], "Roast Cup")
        self.assertIn(f"/message/{self.roast.id}/picture/", card["image"])
        self.assertEqual(card["hot_votes"], 0)
        self.assertIsNone(card["my_vote"])

    def test_roasts_anonymous_gets_401(self):
        response = self.client.get("/api/drill-instructor/message/roasts/")
        self.assertEqual(response.status_code, 401)

    def test_roasts_hidden_from_outsiders(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.get("/api/drill-instructor/message/roasts/")
        self.assertEqual(response.json(), [])

    # ---- voting ----------------------------------------------------------

    def test_member_votes_hot(self):
        self.client.force_authenticate(self.athlete)
        response = self.client.post(f"/api/drill-instructor/message/{self.roast.id}/vote/", {"hot": True}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["hot_votes"], 1)
        self.assertTrue(response.json()["my_vote"])

    def test_second_vote_is_refused(self):
        self.client.force_authenticate(self.athlete)
        first = self.client.post(f"/api/drill-instructor/message/{self.roast.id}/vote/", {"hot": True}, format="json")
        self.assertEqual(first.status_code, 200)
        response = self.client.post(f"/api/drill-instructor/message/{self.roast.id}/vote/", {"hot": False}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.roast.photo_votes.count(), 1)
        self.assertTrue(self.roast.photo_votes.get().hot)

    def test_roasts_list_omits_cards_the_caller_already_rated(self):
        self.client.force_authenticate(self.athlete)
        self.client.post(f"/api/drill-instructor/message/{self.roast.id}/vote/", {"hot": True}, format="json")
        response = self.client.get("/api/drill-instructor/message/roasts/")
        self.assertEqual(response.json(), [])
        # The owner has not voted - the card is still in their stack.
        self.client.force_authenticate(self.owner)
        cards = self.client.get("/api/drill-instructor/message/roasts/").json()
        self.assertEqual([c["id"] for c in cards], [self.roast.id])

    def test_outsider_vote_gets_404(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.post(f"/api/drill-instructor/message/{self.roast.id}/vote/", {"hot": True}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_vote_rejected_on_plain_photo_post(self):
        self.client.force_authenticate(self.athlete)
        response = self.client.post(f"/api/drill-instructor/message/{self.photo.id}/vote/", {"hot": True}, format="json")
        self.assertEqual(response.status_code, 400)  # only coach roasts are votable

    def test_vote_requires_boolean(self):
        self.client.force_authenticate(self.athlete)
        response = self.client.post(f"/api/drill-instructor/message/{self.roast.id}/vote/", {"hot": "yes"}, format="json")
        self.assertEqual(response.status_code, 400)


class InactivityNudgePeriodicTaskTests(TestCase):
    """Migration 0007 seeds the PeriodicTask row the DatabaseScheduler
    needs - without it the celery.py beat entry alone would never fire."""

    def test_periodic_task_seeded(self):
        from django_celery_beat.models import PeriodicTask

        task = PeriodicTask.objects.get(name="drill_instructor_inactivity_nudge")
        self.assertEqual(task.task, "drill_instructor.tasks.post_inactivity_nudges")
        self.assertTrue(task.enabled)
        self.assertEqual(task.crontab.hour, "17")
        self.assertEqual(task.crontab.minute, "10")


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class WorkoutCommentIdempotencyTests(TestCase):
    """One coach comment per competition per workout. Double enqueues
    (double submit, sync edge cases, broker redelivery) must never
    produce a second, identical coach message."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        llm_patcher = mock.patch(
            "drill_instructor.tasks.generate_message",
            return_value=("Sarge says: solid run!", None),
        )
        self.addCleanup(llm_patcher.stop)
        llm_patcher.start()

        self.persona = DrillInstructorPersona.objects.create(
            name="Idem Sergeant", system_prompt="You are a test sergeant.",
        )
        self.athlete = _user("idem-athlete@example.com", "Ivy")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.athlete,
            name="Idem Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=4),
        )
        self.athlete.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=self.persona,
            comment_on_activity=True,
        )
        self.workout = Workout.objects.create(
            user=self.athlete,
            sport_type="Run",
            start_datetime=timezone.now(),
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )

    def test_double_enqueue_posts_only_once(self):
        from .tasks import post_workout_comment

        first = post_workout_comment(self.workout.id)
        second = post_workout_comment(self.workout.id)

        self.assertEqual(first["posted"], 1)
        self.assertEqual(second["posted"], 0)
        self.assertEqual(
            DrillInstructorMessage.objects.filter(
                config=self.config, workout=self.workout,
                kind=DrillInstructorMessage.KIND_ACTIVITY,
            ).count(),
            1,
        )

    def test_db_constraint_blocks_concurrent_duplicates(self):
        from django.db import IntegrityError

        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_ACTIVITY,
            workout=self.workout, body="first",
        )
        from django.db import transaction
        with self.assertRaises(IntegrityError):
            # Own atomic block: the expected failure must not poison the
            # outer test transaction for the following reply insert.
            with transaction.atomic():
                DrillInstructorMessage.objects.create(
                    config=self.config, kind=DrillInstructorMessage.KIND_ACTIVITY,
                    workout=self.workout, body="duplicate",
                )
        # Other kinds on the same workout are unaffected.
        DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REPLY,
            workout=self.workout, body="reply is fine",
        )


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ArcadeGameTests(TestCase):
    """Daily order, dunce megaphone, mood, dog tags, hall of roasts."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        llm = mock.patch("drill_instructor.llm_client.generate_message", return_value=("ORDER UP", None))
        self.addCleanup(llm.stop)
        llm.start()
        vision = mock.patch("drill_instructor.llm_client.read_cached_capabilities", return_value=(False, False))
        self.addCleanup(vision.stop)
        vision.start()

        self.persona = DrillInstructorPersona.objects.create(
            name="Arcade Sergeant", system_prompt="Bark.",
        )
        self.owner = _user("arcade-owner@example.com", "Omar")
        self.alex = _user("arcade-alex@example.com", "Alex")
        self.nina = _user("arcade-nina@example.com", "Nina")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Arcade Cup",
            start_date=today - datetime.timedelta(days=2),
            end_date=today + datetime.timedelta(days=10),
        )
        self.alex.my_competitions.add(self.competition)
        self.nina.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition, enabled=True, persona=self.persona,
        )
        self.client = APIClient()

    def _workout(self, user, minutes=30, when=None):
        w = Workout(
            user=user, sport_type="Run",
            start_datetime=when or timezone.now(),
            duration=datetime.timedelta(minutes=minutes),
            intensity_category=2,
        )
        w.save(score=False)
        return w

    def _points(self, user, capped):
        from competition.models import ActivityGoal, Points
        goal = getattr(self, "_goal", None)
        if goal is None:
            goal = ActivityGoal.objects.create(
                competition=self.competition, name="Minutes", metric="min", goal=30, period="day",
            )
            self._goal = goal
        w = self._workout(user, minutes=max(1, int(capped)))
        return Points.objects.create(goal=goal, workout=w, points_raw=capped, points_capped=capped)

    def test_issue_daily_order_is_idempotent(self):
        from .tasks import issue_daily_orders
        first = issue_daily_orders()
        second = issue_daily_orders()
        self.assertEqual(first["issued"], 1)
        self.assertEqual(second["issued"], 0)
        from .models import DailyOrder
        self.assertEqual(DailyOrder.objects.filter(config=self.config).count(), 1)
        self.assertTrue(DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_ORDER,
        ).exists())

    def test_logging_completes_log_one_order(self):
        from .game import evaluate_workout_game
        from .models import DailyOrder
        today = timezone.localdate()
        order = DailyOrder.objects.create(
            config=self.config, date=today, kind="log_one", spec={}, brief="Log one.",
        )
        w = self._workout(self.alex)
        evaluate_workout_game(w, self.config)
        self.assertTrue(order.completed_by.filter(pk=self.alex.id).exists())
        from competition.models import Points
        from competition.scorer import ORDER_AWARD_NAME, ORDER_BONUS_POINTS
        bonus = Points.objects.get(workout=w, award__name=ORDER_AWARD_NAME)
        self.assertEqual(float(bonus.points_capped), float(ORDER_BONUS_POINTS))
        self.assertEqual(bonus.award.competition_id, self.competition.id)
        # idempotent
        evaluate_workout_game(w, self.config)
        self.assertEqual(order.completed_by.count(), 1)
        self.assertEqual(
            Points.objects.filter(workout=w, award__name=ORDER_AWARD_NAME).count(), 1,
        )

    def test_photo_proof_order_grants_bonus_on_the_activity(self):
        from competition.models import Points
        from competition.scorer import ORDER_AWARD_NAME, ORDER_BONUS_POINTS
        from .game import evaluate_photo_game
        from .models import DailyOrder
        today = timezone.localdate()
        order = DailyOrder.objects.create(
            config=self.config, date=today, kind="photo_proof", spec={}, brief="Pic.",
        )
        w = self._workout(self.alex)
        root = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_ACTIVITY,
            workout=w, body="Go.",
        )
        photo = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PHOTO,
            user=self.alex, parent=root, workout=w, body="",
        )
        evaluate_photo_game(photo)
        self.assertTrue(order.completed_by.filter(pk=self.alex.id).exists())
        bonus = Points.objects.get(workout=w, award__name=ORDER_AWARD_NAME)
        self.assertEqual(float(bonus.points_capped), float(ORDER_BONUS_POINTS))

    def test_close_order_sighs_at_slackers(self):
        from .models import DailyOrder
        from .tasks import close_daily_orders
        today = timezone.localdate()
        order = DailyOrder.objects.create(
            config=self.config, date=today, kind="log_one", spec={}, brief="Log one.",
        )
        order.completed_by.add(self.alex)
        result = close_daily_orders()
        self.assertEqual(result["sighed"], 1)
        self.assertTrue(DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_SIGH,
        ).exists())
        order.refresh_from_db()
        self.assertTrue(order.failed_announced)
        close_daily_orders()
        self.assertEqual(DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_SIGH,
        ).count(), 1)

    def test_dunce_is_last_place_and_clears_on_log(self):
        from .game import evaluate_workout_game, pick_last_place
        from .tasks import assign_dunces
        self._points(self.alex, 100)
        self._points(self.nina, 10)
        self.assertEqual(pick_last_place(self.competition).id, self.nina.id)
        assign_dunces()
        self.config.refresh_from_db()
        self.assertEqual(self.config.dunce_id, self.nina.id)
        self.assertTrue(DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_DUNCE,
        ).exists())
        w = self._workout(self.nina)
        evaluate_workout_game(w, self.config)
        self.config.refresh_from_db()
        self.assertIsNone(self.config.dunce_id)
        from .models import DogTag
        self.assertTrue(DogTag.objects.filter(user=self.nina, slug="survived_the_dunce").exists())

    def test_first_blood_and_photogenic_tags(self):
        from .game import evaluate_photo_game, evaluate_workout_game
        from .models import DogTag
        w = self._workout(self.alex)
        evaluate_workout_game(w, self.config)
        self.assertTrue(DogTag.objects.filter(user=self.alex, slug="first_blood").exists())
        photo = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PHOTO,
            user=self.alex, body="", parent=None,
        )
        evaluate_photo_game(photo)
        self.assertTrue(DogTag.objects.filter(user=self.alex, slug="photogenic").exists())

    def test_mood_disappointed_then_proud(self):
        from .game import coach_mood
        mood = coach_mood(self.config)
        self.assertEqual(mood["key"], "disappointed")
        self.assertEqual(mood["active_24h"], 0)
        self._workout(self.alex)
        self._workout(self.nina)
        mood = coach_mood(self.config)
        self.assertIn(mood["key"], ("proud", "unleashed", "watching"))
        self.assertEqual(mood["active_24h"], 2)
        self._workout(self.alex, when=timezone.now() - datetime.timedelta(hours=36))
        mood = coach_mood(self.config)
        self.assertEqual(mood["active_24h"], 2)
        self.assertGreaterEqual(mood["active_48h"], 2)

    def test_config_payload_exposes_arcade(self):
        from .models import DailyOrder
        today = timezone.localdate()
        DailyOrder.objects.create(config=self.config, date=today, kind="log_one", spec={}, brief="Log one.")
        self.config.dunce = self.nina
        self.config.dunce_since = timezone.now()
        self.config.save()
        self.client.force_authenticate(self.alex)
        response = self.client.get("/api/drill-instructor/config/")
        self.assertEqual(response.status_code, 200)
        row = response.json()[0]
        self.assertEqual(row["daily_order"]["brief"], "Log one.")
        self.assertFalse(row["daily_order"]["completed"])
        self.assertEqual(row["dunce"]["user_id"], self.nina.id)
        self.assertEqual(row["mood"]["key"], "disappointed")

    def test_me_exposes_dog_tags(self):
        from .game import award_tag
        award_tag(self.alex, "first_blood")
        self.client.force_authenticate(self.alex)
        response = self.client.get("/api/user/me/")
        self.assertEqual(response.status_code, 200)
        slugs = [t["slug"] for t in response.json()["dog_tags"]]
        self.assertIn("first_blood", slugs)

    def test_hall_lists_top_roasts_by_hot_votes(self):
        a = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REACTION, body="A", user=None,
        )
        a.image = "message_pics/a.png"
        a.save()
        b = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REACTION, body="B", user=None,
        )
        b.image = "message_pics/b.png"
        b.save()
        from .models import DrillInstructorPhotoVote
        DrillInstructorPhotoVote.objects.create(message=b, user=self.alex, hot=True)
        DrillInstructorPhotoVote.objects.create(message=b, user=self.nina, hot=True)
        DrillInstructorPhotoVote.objects.create(message=a, user=self.alex, hot=True)
        self.client.force_authenticate(self.alex)
        response = self.client.get(
            "/api/drill-instructor/message/hall/",
            {"competition": self.competition.id},
        )
        self.assertEqual(response.status_code, 200)
        ids = [row["id"] for row in response.json()]
        self.assertEqual(ids[0], b.id)

    def test_hall_without_competition_lists_membership_roasts(self):
        roast = DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_REACTION, body="A", user=None,
        )
        roast.image = "message_pics/a.png"
        roast.save()
        self.client.force_authenticate(self.alex)
        response = self.client.get("/api/drill-instructor/message/hall/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json()], [roast.id])

    def test_periodic_tasks_seeded(self):
        from django_celery_beat.models import PeriodicTask
        self.assertEqual(
            PeriodicTask.objects.get(name="drill_instructor_daily_order").task,
            "drill_instructor.tasks.issue_daily_orders",
        )
        self.assertEqual(
            PeriodicTask.objects.get(name="drill_instructor_close_order").task,
            "drill_instructor.tasks.close_daily_orders",
        )
        self.assertEqual(
            PeriodicTask.objects.get(name="drill_instructor_assign_dunce").task,
            "drill_instructor.tasks.assign_dunces",
        )
        self.assertEqual(
            PeriodicTask.objects.get(name="drill_instructor_weekly_coach_vote").task,
            "drill_instructor.tasks.apply_weekly_persona_votes",
        )


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PersonaVoteTests(TestCase):
    """Participants vote for next week's coach; Monday seats the winner."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self.client = APIClient()
        self.admin = _user("admin@example.com", "Ada")
        self.owner = _user("owner@example.com", "Olivia")
        self.athlete = _user("athlete@example.com", "Alex")
        self.outsider = _user("out@example.com", "Otto")
        self.sergeant = DrillInstructorPersona.objects.create(
            name="Vote Sergeant", system_prompt="Bark.", is_builtin=True,
        )
        self.roast = DrillInstructorPersona.objects.create(
            name="Vote Roast", system_prompt="Roast.", is_builtin=True,
        )
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Vote Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=20),
        )
        self.athlete.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition, enabled=True, persona=self.sergeant,
        )

    def _ballot(self):
        return self.client.get(f"/api/drill-instructor/config/{self.config.id}/ballot/")

    def _vote(self, persona):
        return self.client.post(
            f"/api/drill-instructor/config/{self.config.id}/vote/",
            {"persona": persona.id},
            format="json",
        )

    def test_member_votes_and_can_change_mind(self):
        self.client.force_authenticate(self.athlete)
        first = self._vote(self.roast)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()["my_vote"], self.roast.id)
        roast_row = next(c for c in first.json()["candidates"] if c["persona"]["id"] == self.roast.id)
        self.assertEqual(roast_row["votes"], 1)
        self.assertTrue(roast_row["leading"])

        second = self._vote(self.sergeant)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["my_vote"], self.sergeant.id)
        self.assertEqual(second.json()["vote_count"], 1)

    def test_outsider_cannot_see_or_vote(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self._ballot().status_code, 404)
        self.assertEqual(self._vote(self.roast).status_code, 404)

    def test_ballot_countdown_is_a_monday(self):
        from .ballot import next_persona_switch_at
        self.client.force_authenticate(self.athlete)
        response = self._ballot()
        self.assertEqual(response.status_code, 200)
        switch = datetime.datetime.fromisoformat(response.json()["next_switch_at"])
        self.assertEqual(switch.weekday(), 0)
        self.assertEqual(switch.hour, 7)
        self.assertEqual(switch.minute, 15)
        nxt = next_persona_switch_at()
        self.assertEqual(nxt.weekday(), 0)

    def test_weekly_apply_seats_winner_and_resets_votes(self):
        from .ballot import apply_persona_votes
        from .models import DrillInstructorMessage, DrillInstructorPersonaVote

        DrillInstructorPersonaVote.objects.create(
            config=self.config, user=self.athlete, persona=self.roast,
        )
        DrillInstructorPersonaVote.objects.create(
            config=self.config, user=self.owner, persona=self.roast,
        )
        result = apply_persona_votes(self.config)
        self.assertTrue(result["switched"])
        self.config.refresh_from_db()
        self.assertEqual(self.config.persona_id, self.roast.id)
        self.assertEqual(self.config.previous_persona_id, self.sergeant.id)
        self.assertIsNotNone(self.config.persona_changed_at)
        self.assertEqual(DrillInstructorPersonaVote.objects.filter(config=self.config).count(), 0)
        handover = DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_HANDOVER,
        )
        self.assertEqual(handover.count(), 1)
        self.assertIn("Vote Roast", handover.get().body)

    def test_pick_winner_empty_unique_and_tie(self):
        from .ballot import pick_winner

        self.assertEqual(pick_winner([], self.sergeant.id), self.sergeant.id)
        with mock.patch("drill_instructor.ballot.random.choice") as choice:
            winner = pick_winner(
                [{"persona": self.roast.id, "n": 3}, {"persona": self.sergeant.id, "n": 1}],
                self.sergeant.id,
            )
        self.assertEqual(winner, self.roast.id)
        choice.assert_not_called()

        with mock.patch("drill_instructor.ballot.random.choice", return_value=self.roast.id) as choice:
            tied = pick_winner(
                [{"persona": self.roast.id, "n": 2}, {"persona": self.sergeant.id, "n": 2}],
                self.sergeant.id,
            )
        self.assertEqual(tied, self.roast.id)
        self.assertCountEqual(choice.call_args[0][0], [self.roast.id, self.sergeant.id])

    def test_weekly_apply_keeps_incumbent_when_nobody_voted(self):
        from .ballot import apply_persona_votes

        empty = apply_persona_votes(self.config)
        self.assertFalse(empty["switched"])
        self.config.refresh_from_db()
        self.assertEqual(self.config.persona_id, self.sergeant.id)

    def test_weekly_apply_breaks_ties_at_random(self):
        from .ballot import apply_persona_votes
        from .models import DrillInstructorPersonaVote

        DrillInstructorPersonaVote.objects.create(
            config=self.config, user=self.athlete, persona=self.roast,
        )
        DrillInstructorPersonaVote.objects.create(
            config=self.config, user=self.owner, persona=self.sergeant,
        )
        with mock.patch("drill_instructor.ballot.random.choice", return_value=self.roast.id) as choice:
            tied = apply_persona_votes(self.config)
        self.assertCountEqual(choice.call_args[0][0], [self.roast.id, self.sergeant.id])
        self.assertTrue(tied["switched"])
        self.config.refresh_from_db()
        self.assertEqual(self.config.persona_id, self.roast.id)
        self.assertEqual(self.config.previous_persona_id, self.sergeant.id)
        self.assertEqual(DrillInstructorPersonaVote.objects.filter(config=self.config).count(), 0)

    def test_weekly_apply_tie_can_keep_incumbent_when_drawn(self):
        from .ballot import apply_persona_votes
        from .models import DrillInstructorPersonaVote

        DrillInstructorPersonaVote.objects.create(
            config=self.config, user=self.athlete, persona=self.roast,
        )
        DrillInstructorPersonaVote.objects.create(
            config=self.config, user=self.owner, persona=self.sergeant,
        )
        with mock.patch("drill_instructor.ballot.random.choice", return_value=self.sergeant.id):
            tied = apply_persona_votes(self.config)
        self.assertFalse(tied["switched"])
        self.config.refresh_from_db()
        self.assertEqual(self.config.persona_id, self.sergeant.id)
        self.assertEqual(DrillInstructorPersonaVote.objects.filter(config=self.config).count(), 0)

    def test_ineligible_persona_is_rejected(self):
        stranger = DrillInstructorPersona.objects.create(
            name="Stranger Voice", system_prompt="Nope.", created_by=self.outsider,
        )
        self.client.force_authenticate(self.athlete)
        response = self._vote(stranger)
        self.assertEqual(response.status_code, 400)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class LegendEchoTests(TestCase):
    """Mint, challenge, claim, immortalize, Book of Echoes."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
            "drill_instructor.tasks.post_workout_comment.delay",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        llm = mock.patch(
            "drill_instructor.llm_client.generate_message",
            return_value=("LEGEND: @Alex planted a flag.", None),
        )
        self.addCleanup(llm.stop)
        llm.start()

        self.persona = DrillInstructorPersona.objects.create(
            name="Echo Sergeant", system_prompt="Bark.",
        )
        self.owner = _user("echo-owner@example.com", "Omar")
        self.alex = _user("echo-alex@example.com", "Alex")
        self.nina = _user("echo-nina@example.com", "Nina")
        self.outsider = _user("echo-out@example.com", "Otto")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Echo Cup",
            start_date=today - datetime.timedelta(days=3),
            end_date=today + datetime.timedelta(days=20),
        )
        self.alex.my_competitions.add(self.competition)
        self.nina.my_competitions.add(self.competition)
        self.config = DrillInstructorConfig.objects.create(
            competition=self.competition, enabled=True, persona=self.persona,
        )
        self.client = APIClient()

    def _workout(self, user, minutes=30, distance=None, sport="Run", when=None):
        w = Workout(
            user=user, sport_type=sport,
            start_datetime=when or timezone.now(),
            duration=datetime.timedelta(minutes=minutes),
            distance=distance,
            intensity_category=2,
        )
        w.save(score=False)
        return w

    def test_first_short_workout_is_not_an_echo(self):
        from .echoes import mint_echo
        echo = mint_echo(self._workout(self.alex, minutes=30), self.config)
        self.assertIsNone(echo)

    def test_steps_never_mint(self):
        from .echoes import mint_echo
        steps = self._workout(self.alex, minutes=120)
        Workout.objects.filter(pk=steps.pk).update(sport_type="Steps", steps=20000)
        steps.refresh_from_db()
        echo = mint_echo(steps, self.config)
        self.assertIsNone(echo)

    def test_first_flag_mints_and_posts(self):
        from .echoes import mint_echo
        from .models import LegendEcho
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        self.assertIsNotNone(echo)
        self.assertEqual(echo.status, LegendEcho.STATUS_UNDEFEATED)
        self.assertEqual(echo.holder_id, self.alex.id)
        self.assertGreaterEqual(echo.power, 1)
        self.assertTrue(DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_ECHO,
        ).exists())
        self.client.force_authenticate(self.alex)
        me = self.client.get("/api/user/me/")
        self.assertEqual(me.status_code, 200, me.content)
        self.assertGreaterEqual(me.json().get("echoes_held") or 0, 1)
        self.client.force_authenticate(self.nina)
        listed = self.client.get("/api/user/")
        self.assertEqual(listed.status_code, 200, listed.content)
        other = next(row for row in listed.json() if row["id"] == self.alex.id)
        self.assertGreaterEqual(other.get("echoes_held") or 0, 1)

    def test_personal_best_needs_a_prior_same_sport(self):
        from .echoes import mint_echo
        mint_echo(self._workout(self.nina, minutes=45), self.config)
        prior = self._workout(self.alex, minutes=35)
        self.assertIsNone(mint_echo(prior, self.config))
        better = self._workout(self.alex, minutes=50)
        echo = mint_echo(better, self.config)
        self.assertIsNotNone(echo)
        self.assertEqual(echo.origin_user_id, self.alex.id)

    def test_mythic_size_mints(self):
        from .echoes import mint_echo
        echo = mint_echo(self._workout(self.alex, minutes=95), self.config)
        self.assertIsNotNone(echo)

    def test_bike_variants_share_one_echo_family(self):
        from .echoes import mint_echo, resolve_workout_challenges, start_challenge
        echo = mint_echo(self._workout(self.alex, minutes=95, sport="GravelRide"), self.config)
        self.assertIsNotNone(echo)
        self.assertEqual(echo.sport_type, "Ride")
        self.assertIn("Cycling", echo.title)
        start_challenge(echo, self.nina)
        claimed = resolve_workout_challenges(
            self._workout(self.nina, minutes=120, sport="MountainBikeRide"), self.config,
        )
        self.assertEqual(len(claimed), 1)
        echo.refresh_from_db()
        self.assertEqual(echo.holder_id, self.nina.id)
        self.assertEqual(echo.sport_type, "Ride")

    def test_personal_best_counts_run_variants(self):
        from .echoes import mint_echo
        mint_echo(self._workout(self.nina, minutes=45, sport="Ride"), self.config)
        self.assertIsNone(mint_echo(self._workout(self.alex, minutes=35, sport="Run"), self.config))
        echo = mint_echo(self._workout(self.alex, minutes=50, sport="TrailRun"), self.config)
        self.assertIsNotNone(echo)
        self.assertEqual(echo.sport_type, "Run")

    def test_cooldown_blocks_a_second_flag(self):
        from .echoes import mint_echo
        first = mint_echo(self._workout(self.alex, minutes=95), self.config)
        self.assertIsNotNone(first)
        second = mint_echo(self._workout(self.alex, minutes=96), self.config)
        self.assertIsNone(second)

    def test_challenge_claim_and_slayer_tag(self):
        from .echoes import mint_echo, resolve_workout_challenges, start_challenge
        from .models import DogTag, EchoChallenge, LegendEcho
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        start_challenge(echo, self.nina)
        echo.refresh_from_db()
        self.assertEqual(echo.status, LegendEcho.STATUS_CONTESTED)
        with self.assertRaises(ValueError):
            start_challenge(echo, self.owner)
        beat = self._workout(self.nina, minutes=60)
        claimed = resolve_workout_challenges(beat, self.config)
        self.assertEqual(len(claimed), 1)
        echo.refresh_from_db()
        self.assertEqual(echo.holder_id, self.nina.id)
        self.assertEqual(echo.chain_length, 2)
        self.assertEqual(echo.status, LegendEcho.STATUS_UNDEFEATED)
        self.assertGreater(echo.metric_value, 45)
        self.assertIsNone(mint_echo(beat, self.config))
        self.assertTrue(DogTag.objects.filter(user=self.nina, slug="echo_slayer").exists())
        self.assertTrue(DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_CLAIM,
        ).exists())
        self.assertEqual(
            EchoChallenge.objects.filter(echo=echo, status=EchoChallenge.STATUS_WON).count(), 1,
        )

    def test_challenge_posts_coach_comment(self):
        from .echoes import mint_echo, start_challenge
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        with mock.patch(
            "drill_instructor.llm_client.generate_message",
            return_value=("@Nina just declared war on @Alex's Echo. Seven days. Move.", None),
        ):
            start_challenge(echo, self.nina)
        wars = DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_WAR,
        )
        self.assertEqual(wars.count(), 1)
        self.assertIn("declared war", wars.get().body.lower())

    def test_challenge_comment_falls_back_when_llm_fails(self):
        from .echoes import mint_echo, start_challenge
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        with mock.patch(
            "drill_instructor.llm_client.generate_message",
            side_effect=RuntimeError("llm down"),
        ):
            start_challenge(echo, self.nina)
        war = DrillInstructorMessage.objects.get(
            config=self.config, kind=DrillInstructorMessage.KIND_WAR,
        )
        self.assertIn("declared war", war.body.lower())
        self.assertIn("@Nina", war.body)
        self.assertIn("@Alex", war.body)

    def test_holder_cannot_challenge_own_echo(self):
        from .echoes import mint_echo, start_challenge
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        with self.assertRaises(ValueError):
            start_challenge(echo, self.alex)

    def test_tie_does_not_claim(self):
        from .echoes import mint_echo, resolve_workout_challenges, start_challenge
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        start_challenge(echo, self.nina)
        claimed = resolve_workout_challenges(self._workout(self.nina, minutes=45), self.config)
        self.assertEqual(claimed, [])
        echo.refresh_from_db()
        self.assertEqual(echo.holder_id, self.alex.id)

    def test_three_defenses_immortalize(self):
        from .echoes import expire_challenges, mint_echo, start_challenge
        from .models import DogTag, EchoChallenge, LegendEcho
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        for _ in range(3):
            challenge = start_challenge(echo, self.nina)
            EchoChallenge.objects.filter(pk=challenge.pk).update(
                window_end=timezone.now() - datetime.timedelta(minutes=1),
            )
            expire_challenges()
            echo.refresh_from_db()
        self.assertEqual(echo.status, LegendEcho.STATUS_IMMORTAL)
        self.assertTrue(DogTag.objects.filter(user=self.alex, slug="echo_immortal").exists())

    def test_season_end_immortalizes_survivors(self):
        from .echoes import expire_challenges, mint_echo, start_challenge
        from .models import EchoChallenge, LegendEcho
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        war = start_challenge(echo, self.nina)
        self.competition.end_date = timezone.localdate() - datetime.timedelta(days=1)
        self.competition.save()
        result = expire_challenges()
        self.assertGreaterEqual(result["immortal"], 1)
        echo.refresh_from_db()
        self.assertEqual(echo.status, LegendEcho.STATUS_IMMORTAL)
        war.refresh_from_db()
        self.assertIn(war.status, (EchoChallenge.STATUS_LOST, EchoChallenge.STATUS_EXPIRED))

    def test_backdated_workout_cannot_claim(self):
        from .echoes import mint_echo, resolve_workout_challenges, start_challenge
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        start_challenge(echo, self.nina)
        past = self._workout(
            self.nina, minutes=120,
            when=timezone.now() - datetime.timedelta(days=3),
        )
        self.assertEqual(resolve_workout_challenges(past, self.config), [])
        echo.refresh_from_db()
        self.assertEqual(echo.holder_id, self.alex.id)

    def test_lapsed_window_unlocks_on_the_next_action(self):
        from .echoes import mint_echo, start_challenge
        from .models import EchoChallenge, LegendEcho
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        war = start_challenge(echo, self.nina)
        EchoChallenge.objects.filter(pk=war.pk).update(
            window_end=timezone.now() - datetime.timedelta(minutes=1),
        )
        start_challenge(echo, self.owner)
        echo.refresh_from_db()
        self.assertEqual(echo.status, LegendEcho.STATUS_CONTESTED)
        war.refresh_from_db()
        self.assertEqual(war.status, EchoChallenge.STATUS_EXPIRED)

    def test_expired_war_posts_to_the_feed(self):
        from .echoes import expire_challenges, mint_echo, start_challenge
        from .models import EchoChallenge
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        challenge = start_challenge(echo, self.nina)
        EchoChallenge.objects.filter(pk=challenge.pk).update(
            window_end=timezone.now() - datetime.timedelta(minutes=1),
        )
        expire_challenges()
        held = [
            m.body.lower()
            for m in DrillInstructorMessage.objects.filter(
                config=self.config, kind=DrillInstructorMessage.KIND_ECHO,
            )
        ]
        self.assertTrue(any("still holds" in body or "echo stands" in body for body in held))

    def test_cannot_challenge_after_the_season(self):
        from .echoes import mint_echo, start_challenge
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        self.competition.end_date = timezone.localdate() - datetime.timedelta(days=1)
        self.competition.save()
        with self.assertRaises(ValueError):
            start_challenge(echo, self.nina)

    def test_api_list_challenge_book_and_isolation(self):
        from .echoes import mint_echo
        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        self.client.force_authenticate(self.nina)
        listed = self.client.get("/api/drill-instructor/echoes/", {"competition": self.competition.id})
        self.assertEqual(listed.status_code, 200, listed.content)
        rows = listed.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], echo.id)
        self.assertEqual(rows[0]["holder_id"], self.alex.id)
        self.assertIn("metric_label", rows[0])

        war = self.client.post(f"/api/drill-instructor/echoes/{echo.id}/challenge/")
        self.assertEqual(war.status_code, 200, war.content)
        self.assertEqual(war.json()["status"], "contested")
        self.assertEqual(war.json()["active_challenge"]["challenger_id"], self.nina.id)

        twice = self.client.post(f"/api/drill-instructor/echoes/{echo.id}/challenge/")
        self.assertEqual(twice.status_code, 400)

        book = self.client.get("/api/drill-instructor/echoes/book/", {"competition": self.competition.id})
        self.assertEqual(book.status_code, 200, book.content)
        payload = book.json()
        self.assertEqual(payload["echo_count"], 1)
        self.assertEqual(payload["chapters"][0]["wars"][0]["challenger"], "Nina")

        self.client.force_authenticate(self.outsider)
        hidden = self.client.get("/api/drill-instructor/echoes/", {"competition": self.competition.id})
        self.assertEqual(hidden.status_code, 200)
        self.assertEqual(hidden.json(), [])
        forbidden = self.client.post(f"/api/drill-instructor/echoes/{echo.id}/challenge/")
        self.assertEqual(forbidden.status_code, 404)
        no_book = self.client.get("/api/drill-instructor/echoes/book/", {"competition": self.competition.id})
        self.assertEqual(no_book.status_code, 404)

    def test_owner_deletes_echo_wars_and_art(self):
        from django.core.files.base import ContentFile
        from .echoes import mint_echo, start_challenge
        from .models import EchoChallenge, LegendEcho

        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        media_override = override_settings(MEDIA_ROOT=media.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        echo.image.save("echo-art.png", ContentFile(PNG_1PX), save=True)
        art_path = echo.image.path
        start_challenge(echo, self.nina)
        self.assertTrue(EchoChallenge.objects.filter(echo=echo).exists())

        self.client.force_authenticate(self.nina)
        denied = self.client.delete(f"/api/drill-instructor/echoes/{echo.id}/")
        self.assertEqual(denied.status_code, 403)
        self.assertTrue(LegendEcho.objects.filter(pk=echo.id).exists())

        self.client.force_authenticate(self.outsider)
        hidden = self.client.delete(f"/api/drill-instructor/echoes/{echo.id}/")
        self.assertEqual(hidden.status_code, 404)

        self.client.force_authenticate(self.owner)
        listed = self.client.get("/api/drill-instructor/echoes/", {"competition": self.competition.id})
        self.assertTrue(listed.json()[0]["can_delete"])
        gone = self.client.delete(f"/api/drill-instructor/echoes/{echo.id}/")
        self.assertEqual(gone.status_code, 204)
        self.assertFalse(LegendEcho.objects.filter(pk=echo.id).exists())
        self.assertFalse(EchoChallenge.objects.filter(echo_id=echo.id).exists())
        self.assertFalse(os.path.exists(art_path))

    def test_echoes_with_art_list_first(self):
        from django.core.files.base import ContentFile
        from .echoes import mint_echo

        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        media_override = override_settings(MEDIA_ROOT=media.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        weaker = mint_echo(self._workout(self.nina, minutes=45), self.config)
        stronger = mint_echo(self._workout(self.alex, minutes=95), self.config)
        self.assertGreater(stronger.power, weaker.power)
        weaker.image.save("nina-echo.png", ContentFile(PNG_1PX), save=True)

        self.client.force_authenticate(self.alex)
        listed = self.client.get("/api/drill-instructor/echoes/", {"competition": self.competition.id})
        self.assertEqual(listed.status_code, 200, listed.content)
        ids = [row["id"] for row in listed.json()]
        self.assertEqual(ids[0], weaker.id)
        self.assertIn(stronger.id, ids)

    def test_echo_windows_periodic_task_seeded(self):
        from django_celery_beat.models import PeriodicTask
        task = PeriodicTask.objects.get(name="drill_instructor_echo_windows")
        self.assertEqual(task.task, "drill_instructor.tasks.resolve_echo_windows")
        self.assertTrue(task.enabled)
        self.assertEqual(task.crontab.minute, "*/15")

    def test_holder_can_upload_echo_art_non_holder_cannot(self):
        from .echoes import mint_echo
        from .models import LegendEcho

        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        media_override = override_settings(MEDIA_ROOT=media.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        self.assertIsNotNone(echo)
        self.assertFalse(echo.image)

        upload = SimpleUploadedFile("pose.png", PNG_1PX, content_type="image/png")
        with mock.patch("drill_instructor.tasks.remix_echo_art.delay") as queued:
            self.client.force_authenticate(self.alex)
            ok = self.client.post(
                f"/api/drill-instructor/echoes/{echo.id}/art/",
                {"image": upload},
                format="multipart",
            )
        self.assertEqual(ok.status_code, 200, ok.content)
        body = ok.json()
        self.assertTrue(body["can_upload_art"])
        self.assertTrue(body["image"])
        queued.assert_called_once_with(echo.id, uploaded_by_id=self.alex.id)
        art_posts = DrillInstructorMessage.objects.filter(
            config=self.config, kind=DrillInstructorMessage.KIND_ECHO,
        ).exclude(image="")
        self.assertTrue(art_posts.exists())
        self.assertIn("picture", art_posts.latest("posted_at").body.lower())
        echo = LegendEcho.objects.get(pk=echo.id)
        self.assertTrue(echo.image)

        self.client.force_authenticate(self.nina)
        listed = self.client.get("/api/drill-instructor/echoes/", {"competition": self.competition.id})
        self.assertFalse(listed.json()[0]["can_upload_art"])
        denied = self.client.post(
            f"/api/drill-instructor/echoes/{echo.id}/art/",
            {"image": SimpleUploadedFile("x.png", PNG_1PX, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(denied.status_code, 403)

        self.nina.is_staff = True
        self.nina.save(update_fields=["is_staff"])
        listed = self.client.get("/api/drill-instructor/echoes/", {"competition": self.competition.id})
        self.assertFalse(listed.json()[0]["can_upload_art"])
        still_denied = self.client.post(
            f"/api/drill-instructor/echoes/{echo.id}/art/",
            {"image": SimpleUploadedFile("staff.png", PNG_1PX, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(still_denied.status_code, 403)

        pic = self.client.get(f"/api/drill-instructor/echoes/{echo.id}/picture/")
        self.assertEqual(pic.status_code, 200)
        self.assertTrue(pic["Content-Type"].startswith("image/"))

    def test_remix_echo_art_skips_if_holder_changed(self):
        from django.core.files.base import ContentFile
        from .echoes import mint_echo
        from .tasks import remix_echo_art

        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        media_override = override_settings(MEDIA_ROOT=media.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        echo.image.save("echo-orig.jpg", ContentFile(PNG_1PX), save=True)
        result = remix_echo_art(echo.id, uploaded_by_id=self.nina.id)
        self.assertEqual(result.get("skipped"), "holder changed")

    def test_remix_echo_art_overwrites_with_edited_bytes(self):
        from django.core.files.base import ContentFile
        from .echoes import mint_echo
        from .models import LegendEcho
        from .tasks import remix_echo_art

        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        media_override = override_settings(MEDIA_ROOT=media.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        echo.image.save("echo-orig.jpg", ContentFile(PNG_1PX), save=True)
        edited = b"\x89PNG\r\n\x1a\n" + b"edited-bytes"
        with mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value="grok-imagine-image"), \
                mock.patch("drill_instructor.tasks.generate_roast_image", return_value=(edited, None)):
            result = remix_echo_art(echo.id)
        self.assertTrue(result.get("ok"))
        echo = LegendEcho.objects.get(pk=echo.id)
        echo.image.open("rb")
        try:
            self.assertEqual(echo.image.read(), edited)
        finally:
            echo.image.close()

    def test_remix_echo_art_keeps_original_when_edit_unavailable(self):
        from django.core.files.base import ContentFile
        from .echoes import mint_echo
        from .tasks import remix_echo_art

        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        media_override = override_settings(MEDIA_ROOT=media.name)
        media_override.enable()
        self.addCleanup(media_override.disable)

        echo = mint_echo(self._workout(self.alex, minutes=45), self.config)
        echo.image.save("echo-orig.jpg", ContentFile(PNG_1PX), save=True)
        with mock.patch("drill_instructor.tasks.check_image_edit_capability", return_value=None):
            result = remix_echo_art(echo.id)
        self.assertEqual(result.get("skipped"), "no image-edit model")
        echo.refresh_from_db()
        echo.image.open("rb")
        try:
            self.assertEqual(echo.image.read(), PNG_1PX)
        finally:
            echo.image.close()


class EchoArtPromptTests(TestCase):
    def test_prompt_includes_title_sport_and_feat(self):
        from .llm_client import build_echo_art_prompt, echo_sport_scene
        prompt = build_echo_art_prompt(
            title="The First Flag",
            narrative="Alex planted a flag.",
            sport_type="Run",
            metric_label="45 min Run",
            power=12,
            persona_name="Drill Sergeant",
        )
        self.assertIn("The First Flag", prompt)
        self.assertIn("Run", prompt)
        self.assertIn("45 min Run", prompt)
        self.assertIn("Drill Sergeant", prompt)
        self.assertIn("together with their coach", prompt.lower())
        self.assertIn("COACH WORLD", prompt)
        self.assertIn("boot-camp", prompt.lower())
        self.assertIn("STATS OVERLAY", prompt)
        self.assertIn("trail", echo_sport_scene("TrailRun").lower())
        self.assertIn("treadmill", echo_sport_scene("VirtualRun").lower())

    def test_prompt_face_locks_coach_portrait(self):
        from .llm_client import build_echo_art_prompt
        locked = build_echo_art_prompt(
            title="Flag", sport_type="Run", persona_name="Roast Master",
            has_coach_portrait=True,
        )
        self.assertIn("FACE LOCK", locked)
        self.assertIn("IMAGE 2", locked)
        free = build_echo_art_prompt(
            title="Flag", sport_type="Run", persona_name="Roast Master",
            has_coach_portrait=False,
        )
        self.assertIn("no portrait reference", free)
        self.assertNotIn("FACE LOCK", free)

    def test_custom_coach_world_uses_avatar_or_description(self):
        from .llm_client import coach_echo_world
        from_avatar = coach_echo_world(persona_name="Captain Nova", persona_avatar="captain")
        self.assertIn("sky-ship", from_avatar.lower())
        from_desc = coach_echo_world(
            persona_name="Moon Goat",
            persona_description="A disco goat who coaches from a glitter ball.",
        )
        self.assertIn("disco goat", from_desc.lower())


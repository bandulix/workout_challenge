import base64
import datetime
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
    """Personas are a global library: any authenticated user can read
    them (competition owners pick one), but only admins may create,
    edit or delete - and the voice & style briefing (system_prompt) is
    only serialized for staff."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
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
        )

    def test_regular_user_can_read_but_not_see_style_briefing(self):
        self.client.force_authenticate(self.regular)
        response = self.client.get("/api/drill-instructor/persona/")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()), 1)
        self.assertNotIn("system_prompt", response.json()[0])

    def test_admin_sees_style_briefing(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/drill-instructor/persona/")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()[0]["system_prompt"], "You are a test sergeant.")

    def test_regular_user_cannot_create(self):
        self.client.force_authenticate(self.regular)
        response = self.client.post(
            "/api/drill-instructor/persona/",
            {"name": "Rogue Coach", "system_prompt": "Ignore all rules."},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(DrillInstructorPersona.objects.filter(name="Rogue Coach").exists())

    def test_regular_user_cannot_update(self):
        self.client.force_authenticate(self.regular)
        response = self.client.patch(
            f"/api/drill-instructor/persona/{self.persona.id}/",
            {"system_prompt": "Ignore all rules."},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.persona.refresh_from_db()
        self.assertEqual(self.persona.system_prompt, "You are a test sergeant.")

    def test_regular_user_cannot_delete(self):
        self.client.force_authenticate(self.regular)
        response = self.client.delete(f"/api/drill-instructor/persona/{self.persona.id}/")

        self.assertEqual(response.status_code, 403)
        self.assertTrue(DrillInstructorPersona.objects.filter(id=self.persona.id).exists())

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
        # The very first user auto-becomes the admin (see CustomUser.save).
        self.admin = _user("admin@example.com", "Ada")
        self.regular = _user("user@example.com", "Uli")
        self.persona = DrillInstructorPersona.objects.create(
            name="Pictured Sergeant",
            system_prompt="You are a test sergeant.",
        )
        self.persona.profile_picture.save(
            "coach.png", SimpleUploadedFile("coach.png", PNG_1PX, content_type="image/png")
        )
        self.url = f"/api/drill-instructor/persona/{self.persona.id}/picture/"

    def test_anonymous_gets_401(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 401)

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
        )
        self.client.force_authenticate(self.regular)

        response = self.client.get(f"/api/drill-instructor/persona/{plain.id}/picture/")

        self.assertEqual(response.status_code, 404)

    def test_list_payload_uses_authenticated_url(self):
        DrillInstructorPersona.objects.create(name="Plain Coach", system_prompt="You are plain.")
        self.client.force_authenticate(self.regular)
        response = self.client.get("/api/drill-instructor/persona/")

        payload = {p["name"]: p for p in response.json()}
        self.assertIn(self.url, payload["Pictured Sergeant"]["profile_picture"])
        self.assertNotIn("/media/", payload["Pictured Sergeant"]["profile_picture"])
        self.assertIsNone(payload["Plain Coach"]["profile_picture"])


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
            "custom_user.models.welcome_email.apply_async",
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
            "custom_user.models.welcome_email.apply_async",
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
    """The random daily group push: 1-2 persona-voiced pep talks per day
    at drawn random times, independent of activity."""

    def setUp(self):
        # Same plumbing stubs as the nudge tests: no Celery broker needed.
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.welcome_email.apply_async",
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

    def test_max_two_per_day(self):
        with mock.patch("drill_instructor.tasks._draw_push_plan", return_value=["00:00", "00:01"]):
            result = post_random_pushes()
            self.assertEqual(result["posted"], 2)

            # Even with both slots due, a re-run stays under the hard cap.
            result = post_random_pushes()
            self.assertEqual(result["posted"], 0)
            self.assertEqual(DrillInstructorMessage.objects.count(), 2)

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
    """The random slot draw itself: the min-1/max-2 guarantee and the
    waking-hours window hold for every possible roll."""

    def test_always_at_least_one_slot_max_two(self):
        for _ in range(200):
            plan = _draw_push_plan()
            self.assertGreaterEqual(len(plan), 1)
            self.assertLessEqual(len(plan), 2)

    def test_slots_within_waking_hours_and_sorted(self):
        for _ in range(200):
            plan = _draw_push_plan()
            self.assertEqual(plan, sorted(plan))
            for slot in plan:
                self.assertRegex(slot, r"^\d{2}:\d{2}$")
                self.assertGreaterEqual(int(slot[:2]), 7)
                self.assertLess(int(slot[:2]), 22)

    def test_two_slots_kept_apart(self):
        for _ in range(200):
            plan = _draw_push_plan()
            if len(plan) == 2:
                first = int(plan[0][:2]) * 60 + int(plan[0][3:])
                second = int(plan[1][:2]) * 60 + int(plan[1][3:])
                self.assertGreaterEqual(second - first, 90)


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
            "custom_user.models.welcome_email.apply_async",
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


class PhotoPostTests(TestCase):
    """Participants post pictures into the coach feed; the coach reacts
    asynchronously (post_photo_reaction task); the image itself is only
    served through the authenticated picture endpoint."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
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

    def _post(self, user, caption="Proof of the hill repeats!"):
        self.client.force_authenticate(user)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        data = {"competition": self.competition.id, "image": image}
        if caption is not None:
            data["caption"] = caption
        return self.client.post("/api/drill-instructor/message/photo/", data, format="multipart")

    # ---- endpoint permissions & validation ----------------------------

    def test_anonymous_gets_401(self):
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"competition": self.competition.id, "image": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 401)

    def test_outsider_gets_404(self):
        response = self._post(self.outsider)
        self.assertEqual(response.status_code, 404)

    def test_participant_can_post_and_reaction_is_queued(self):
        response = self._post(self.athlete)
        self.assertEqual(response.status_code, 201, response.content)
        message = DrillInstructorMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(message.kind, DrillInstructorMessage.KIND_PHOTO)
        self.assertIsNone(message.parent)
        self.assertEqual(message.user, self.athlete)
        self.assertEqual(message.body, "Proof of the hill repeats!")
        self.assertTrue(message.image.name.startswith("message_pics/"))
        self.reaction_delay.assert_called_once_with(message.id)

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
        self.client.force_authenticate(self.athlete)
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"competition": self.competition.id},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)

    def test_non_image_rejected(self):
        self.client.force_authenticate(self.athlete)
        fake = SimpleUploadedFile("evil.png", b"not an image", content_type="text/plain")
        response = self.client.post(
            "/api/drill-instructor/message/photo/",
            {"competition": self.competition.id, "image": fake},
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
        self.assertEqual(DrillInstructorMessage.objects.count(), 0)

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

    def test_photo_post_is_a_thread_root_in_the_feed(self):
        self._post(self.athlete)
        self.client.force_authenticate(self.athlete)
        response = self.client.get("/api/drill-instructor/message/")
        results = response.json()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["kind"], DrillInstructorMessage.KIND_PHOTO)
        self.assertEqual(results[0]["author_name"], "Alex")

    def test_replies_under_photos_use_the_regular_thread(self):
        post = self._post(self.athlete)
        root_id = post.json()["id"]
        self.client.force_authenticate(self.owner)
        response = self.client.post(f"/api/drill-instructor/message/{root_id}/reply/", {"body": "Nice form!"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)

    # ---- photo as a thread reply (Coach page button) -------------------

    def _coach_root(self):
        return DrillInstructorMessage.objects.create(
            config=self.config, kind=DrillInstructorMessage.KIND_PUSH, body="Show me the effort!",
        )

    def test_photo_reply_to_coach_message(self):
        root = self._coach_root()
        self.client.force_authenticate(self.athlete)
        image = SimpleUploadedFile("photo.png", PNG_1PX, content_type="image/png")
        with mock.patch("drill_instructor.tasks.post_reply_reaction.delay") as reply_task:
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
        reply_task.assert_called_once_with(message.id)  # reply pipeline, not the root pipeline
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

    def test_reply_reaction_task_attaches_photo_when_vision_capable(self):
        from .tasks import post_reply_reaction
        photo_reply = self._photo_message()
        photo_reply.parent = self._coach_root()
        photo_reply.save()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=True), \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - I see it!", None)) as gen:
            result = post_reply_reaction(photo_reply.id)
        _, kwargs = gen.call_args
        self.assertEqual(kwargs["image_path"], photo_reply.image.path)
        self.assertIn("PHOTO", kwargs["user_prompt"])
        reaction = DrillInstructorMessage.objects.get(pk=result["reaction_id"])
        self.assertEqual(reaction.parent, photo_reply.parent)

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

    def test_no_roast_without_vision(self):
        from .tasks import post_photo_reaction
        photo = self._photo_message()
        with mock.patch("drill_instructor.tasks.check_vision_capability", return_value=False), \
                mock.patch("drill_instructor.tasks.check_image_edit_capability") as edit_probe, \
                mock.patch("drill_instructor.tasks.generate_message", return_value=("@Alex - noted!", None)):
            result = post_photo_reaction(photo.id)
        self.assertIsNone(result["roast_id"])
        edit_probe.assert_not_called()  # roasting without seeing = blind edits

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

    def test_xai_edit_400_carries_status_code(self):
        from . import llm_client
        client = llm_client._XaiImageClient("https://api.x.ai/v1", "xai-key", 30)
        resp = mock.Mock(status_code=400)
        with mock.patch("requests.post", return_value=resp):
            with self.assertRaises(Exception) as ctx:
                llm_client._images_edit(client, "xai", "grok-imagine-image", PNG_1PX, "roast it", 30)
        self.assertEqual(ctx.exception.status_code, 400)


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

    def test_url_result_is_downloaded(self):
        client = self._client(url="https://img.example.com/roast.png")
        resp = mock.Mock()
        resp.headers = {"Content-Type": "image/png"}
        resp.content = PNG_1PX
        resp.raise_for_status = lambda: None
        with mock.patch("requests.get", return_value=resp):
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
        get_resp.content = PNG_1PX
        get_resp.raise_for_status = lambda: None
        with mock.patch("requests.post", return_value=post_resp), \
                mock.patch("requests.get", return_value=get_resp):
            data, error = self._generate(client, model="grok-imagine-image", style="xai")
        self.assertIsNone(error)
        self.assertEqual(data, PNG_1PX)


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
    changeable vote per card."""

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

    def test_vote_is_upserted_on_change(self):
        self.client.force_authenticate(self.athlete)
        self.client.post(f"/api/drill-instructor/message/{self.roast.id}/vote/", {"hot": True}, format="json")
        response = self.client.post(f"/api/drill-instructor/message/{self.roast.id}/vote/", {"hot": False}, format="json")
        self.assertEqual(response.json()["hot_votes"], 0)
        self.assertEqual(response.json()["not_votes"], 1)
        self.assertEqual(self.roast.photo_votes.count(), 1)  # one row, not two

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
            "custom_user.models.welcome_email.apply_async",
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

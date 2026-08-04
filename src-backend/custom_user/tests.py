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
from workouts.models import Workout

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


class MapStravaSportTypeTests(TestCase):
    """Strava adds sport types faster than we support them (e.g.
    Basketball, Cricket, Dance, Padel, Physical Therapy, Volleyball in
    2026). Workout.sport_type choices are not DB-enforced, so unknown
    values must be mapped to 'Workout' before they reach the table -
    a verbatim unknown type crashes the frontend's label lookups."""

    def test_known_types_pass_through(self):
        from .strava import _map_sport_type
        self.assertEqual(_map_sport_type("Run"), "Run")
        self.assertEqual(_map_sport_type("Pickleball"), "Pickleball")
        self.assertEqual(_map_sport_type("Workout"), "Workout")

    def test_unknown_types_fall_back_to_workout(self):
        from .strava import _map_sport_type
        for unknown in ("Basketball", "Cricket", "Dance", "Padel", "Volleyball", "PhysicalTherapy", "", None):
            with self.subTest(unknown=unknown):
                self.assertEqual(_map_sport_type(unknown), "Workout")


# DRF throttling and the Strava access-token cache read the Django cache
# - use LocMem so the tests don't need a running Redis.
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ActivitySourceTests(TestCase):
    """One activity source per user: the same physical activity usually
    exists in both ecosystems (recorded on a Garmin watch, auto-synced
    to Strava), so syncing both providers would double every workout."""

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
            email="both@example.com", password="test-pw", first_name="Bo", last_name="",
        )

    def _link_strava(self):
        self.user.strava_refresh_token = "gAAAAAencrypted"
        self.user.strava_athlete_id = 4242
        self.user.save()

    def _link_garmin(self):
        self.user.garmin_email = "both@example.com"
        self.user.garmin_tokens_enc = "gAAAAAencrypted"
        self.user.save()

    # ---- source resolution -------------------------------------------

    def test_nothing_linked(self):
        self.assertIsNone(self.user.get_activity_source())

    def test_only_strava_linked(self):
        self._link_strava()
        self.assertEqual(self.user.get_activity_source(), "strava")

    def test_only_garmin_linked_with_stale_strava_choice(self):
        # Stale stored choice from an earlier Strava link must not
        # matter while Strava is unlinked.
        self._link_garmin()
        self.user.activity_source = "strava"
        self.user.save()
        self.assertEqual(self.user.get_activity_source(), "garmin")

    def test_both_linked_explicit_choice_wins(self):
        self._link_strava()
        self._link_garmin()
        self.user.activity_source = "garmin"
        self.user.save()
        self.assertEqual(self.user.get_activity_source(), "garmin")

    def test_both_linked_without_choice_falls_back_to_strava(self):
        # Legacy rows predate the selector: Strava was the only
        # integration back then.
        self._link_strava()
        self._link_garmin()
        self.assertEqual(self.user.get_activity_source(), "strava")

    # ---- sync task guards ---------------------------------------------

    def test_strava_task_skips_when_garmin_selected(self):
        from .strava import sync_strava
        self._link_strava()
        self._link_garmin()
        self.user.activity_source = "garmin"
        self.user.save()

        result = sync_strava(user__id=self.user.id)
        self.assertEqual(result.get("skipped"), "strava is not the selected activity source")

    def test_garmin_task_skips_when_strava_selected(self):
        from .garmin import sync_garmin
        self._link_strava()
        self._link_garmin()
        self.user.activity_source = "strava"
        self.user.save()

        result = sync_garmin(user__id=self.user.id)
        self.assertEqual(result.get("skipped"), "garmin is not the selected activity source")

    # ---- manual sync view guards ---------------------------------------

    def test_strava_sync_view_blocked_when_garmin_selected(self):
        self._link_strava()
        self._link_garmin()
        self.user.activity_source = "garmin"
        self.user.save()
        self.client.force_authenticate(self.user)

        response = self.client.get("/api/strava/sync/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Garmin", response.json()["message"])

    def test_garmin_sync_view_blocked_when_strava_selected(self):
        self._link_strava()
        self._link_garmin()
        self.user.activity_source = "strava"
        self.user.save()
        self.client.force_authenticate(self.user)

        response = self.client.get("/api/garmin/sync/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Strava", response.json()["message"])


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class CrossProviderDuplicateGuardTests(TestCase):
    """The syncs must never create a second row for an activity that is
    already in the DB from the other provider (or a manual entry)."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()

        self.user = CustomUser.objects.create_user(
            email="dedup@example.com", password="test-pw", first_name="Dee", last_name="",
        )
        self.other_user = CustomUser.objects.create_user(
            email="someoneelse@example.com", password="test-pw", first_name="Sam", last_name="",
        )
        self.start = timezone.now().replace(microsecond=0) - datetime.timedelta(hours=5)
        self.duration = datetime.timedelta(minutes=30)
        self.existing = Workout.objects.create(
            user=self.user,
            sport_type="Run",
            start_datetime=self.start,
            duration=self.duration,
            intensity_category=2,
            strava_id=987654,
        )

    def test_matches_same_user_within_tolerance(self):
        from workouts.models import find_duplicate_workout
        found = find_duplicate_workout(
            self.user,
            self.start + datetime.timedelta(minutes=7),
            self.duration - datetime.timedelta(minutes=3),
        )
        self.assertEqual(found, self.existing)

    def test_ignores_other_users_and_distant_times(self):
        from workouts.models import find_duplicate_workout
        self.assertIsNone(find_duplicate_workout(self.other_user, self.start, self.duration))
        self.assertIsNone(find_duplicate_workout(
            self.user, self.start + datetime.timedelta(minutes=25), self.duration))

    def test_provider_rows_are_not_their_own_duplicates(self):
        from workouts.models import find_duplicate_workout
        # The Strava sync must not treat a Strava-sourced row as a
        # cross-provider duplicate of itself (id-based de-dup handles
        # that path); the Garmin sync must treat it as one.
        self.assertIsNone(find_duplicate_workout(self.user, self.start, self.duration, provider="strava"))
        self.assertEqual(
            find_duplicate_workout(self.user, self.start, self.duration, provider="garmin"),
            self.existing,
        )

    def test_garmin_sync_skips_duplicate_from_strava(self):
        from .garmin import _sync_user_activities
        activity = {
            "activityId": 112233,
            "activityType": {"typeKey": "running"},
            "startTimeGMT": self.start.isoformat().replace("+00:00", "Z"),
            "duration": self.duration.total_seconds(),
            "distance": 8000,
            "calories": 400,
        }
        client = mock.Mock()
        client.get_activities_by_date.return_value = [activity]

        with mock.patch("custom_user.garmin.get_client_for_user", return_value=client):
            result = _sync_user_activities(self.user)

        self.assertEqual(result["created"], 0)
        self.assertEqual(result["duplicates_skipped"], 1)
        self.assertEqual(Workout.objects.filter(user=self.user).count(), 1)
        self.assertFalse(Workout.objects.filter(garmin_id="112233").exists())

    def test_strava_sync_skips_duplicate_from_manual_entry(self):
        from . import strava as strava_module
        from workouts.models import Workout as WorkoutModel

        manual = WorkoutModel.objects.create(
            user=self.user,
            sport_type="Run",
            start_datetime=self.start + datetime.timedelta(minutes=2),
            duration=self.duration,
            intensity_category=2,
        )
        self.user.strava_refresh_token = "gAAAAAencrypted"
        self.user.save()
        cache.set(f"strava_access_token_{self.user.id}", "cached-token", 3600)

        activity = {
            "id": 246810,
            "sport_type": "Run",
            "start_date": (self.start + datetime.timedelta(minutes=5)).isoformat(),
            "moving_time": self.duration.total_seconds(),
            "distance": 8000,
        }
        list_response = mock.Mock()
        list_response.status_code = 200
        list_response.json.return_value = [activity]

        monitor = mock.Mock()
        monitor.ok_workout_requests.return_value = True

        with mock.patch.object(strava_module, "strava_api_monitor", monitor), \
                mock.patch.object(strava_module.requests, "get", return_value=list_response) as mock_get:
            result = strava_module.sync_strava(user__id=self.user.id)

        self.assertEqual(result["new_activities"], 0)
        self.assertEqual(result["duplicates_skipped"], 1)
        # Only the activities LIST was fetched - the duplicate never
        # cost an activity-details request.
        self.assertEqual(mock_get.call_count, 1)
        self.assertFalse(WorkoutModel.objects.filter(strava_id=246810).exists())
        self.assertTrue(WorkoutModel.objects.filter(pk=manual.pk).exists())


class MapHealthSportTypeTests(TestCase):
    """Apple HealthKit / Health Connect type names are mapped onto our
    sport types; unknown strings must fall back to 'Workout' (the
    frontend's label lookups crash on verbatim unknown types)."""

    def test_known_types_map(self):
        from .health import map_health_sport_type
        self.assertEqual(map_health_sport_type("running"), "Run")
        self.assertEqual(map_health_sport_type("BIKING"), "Ride")
        self.assertEqual(map_health_sport_type("swimming_open_water"), "Swim")
        self.assertEqual(map_health_sport_type("traditionalStrengthTraining"), "WeightTraining")
        self.assertEqual(map_health_sport_type("hiit"), "HighIntensityIntervalTraining")

    def test_unknown_types_fall_back_to_workout(self):
        from .health import map_health_sport_type
        for unknown in ("underwater_hockey", "Basketball", "", None, "not-a-real-sport"):
            with self.subTest(unknown=unknown):
                self.assertEqual(map_health_sport_type(unknown), "Workout")

    def test_already_ours_passes_through(self):
        from .health import map_health_sport_type
        self.assertEqual(map_health_sport_type("Pickleball"), "Pickleball")


class HealthWorkoutMappingTests(TestCase):
    """OW workout payload -> Workout field values."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        self.user = CustomUser.objects.create_user(
            email="map@example.com", password="test-pw", first_name="Map", last_name="",
        )

    def _payload(self, **overrides):
        payload = {
            "id": "9f1c2a34-0000-4aaa-bbbb-111122223333",
            "type": "running",
            "name": "Morning Run",
            "start_time": "2026-08-01T06:00:00Z",
            "end_time": "2026-08-01T06:30:00Z",
            "duration_seconds": 1800,
            "calories_kcal": 320.0,
            "distance_meters": 5000.0,
            "avg_heart_rate_bpm": 150,
            "source": {"name": "Health Connect"},
        }
        payload.update(overrides)
        return payload

    def test_full_mapping(self):
        from .health import workout_to_props
        props = workout_to_props(self.user, self._payload())
        self.assertEqual(props["health_id"], "9f1c2a34-0000-4aaa-bbbb-111122223333")
        self.assertEqual(props["sport_type"], "Run")
        self.assertEqual(props["duration"], datetime.timedelta(seconds=1800))
        self.assertEqual(props["distance"], 5.0)
        self.assertEqual(props["kcal"], 320)
        self.assertEqual(props["intensity_category"], 3)
        self.assertEqual(props["start_datetime"].isoformat(), "2026-08-01T06:00:00+00:00")

    def test_duration_derived_from_end_time(self):
        from .health import workout_to_props
        props = workout_to_props(self.user, self._payload(duration_seconds=None))
        self.assertEqual(props["duration"], datetime.timedelta(seconds=1800))

    def test_missing_id_start_or_duration_returns_none(self):
        from .health import workout_to_props
        self.assertIsNone(workout_to_props(self.user, self._payload(id=None)))
        self.assertIsNone(workout_to_props(self.user, self._payload(start_time=None)))
        self.assertIsNone(workout_to_props(self.user, self._payload(duration_seconds=None, end_time=None)))


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class HealthConnectorTests(TestCase):
    """The Open Wearables health connector: source resolution, sync
    dedup, and the link/unlink views."""

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
            email="health@example.com", password="test-pw", first_name="Hea", last_name="",
        )
        self.start = timezone.now().replace(microsecond=0) - datetime.timedelta(hours=5)
        self.duration = datetime.timedelta(minutes=30)

    def _link_health(self):
        self.user.health_user_id = "11111111-2222-3333-4444-555555555555"
        self.user.save()

    def _ow_payload(self, **overrides):
        payload = {
            "id": "9f1c2a34-0000-4aaa-bbbb-111122223333",
            "type": "running",
            "start_time": self.start.isoformat().replace("+00:00", "Z"),
            "end_time": (self.start + self.duration).isoformat().replace("+00:00", "Z"),
            "duration_seconds": self.duration.total_seconds(),
            "calories_kcal": 300.0,
            "distance_meters": 4800.0,
            "avg_heart_rate_bpm": 140,
        }
        payload.update(overrides)
        return payload

    # ---- source resolution -------------------------------------------

    def test_only_health_linked(self):
        self._link_health()
        self.assertEqual(self.user.get_activity_source(), "health")

    def test_health_and_strava_without_choice_prefers_strava(self):
        self.user.strava_refresh_token = "gAAAAAencrypted"
        self._link_health()
        self.assertEqual(self.user.get_activity_source(), "strava")

    def test_health_explicit_choice_wins(self):
        self.user.garmin_tokens_enc = "gAAAAAencrypted"
        self._link_health()
        self.user.activity_source = "health"
        self.user.save()
        self.assertEqual(self.user.get_activity_source(), "health")

    def test_health_task_skips_when_other_source_selected(self):
        from .health import sync_health
        self.user.strava_refresh_token = "gAAAAAencrypted"
        self._link_health()
        result = sync_health(user__id=self.user.id)
        self.assertEqual(result.get("skipped"), "health is not the selected activity source")

    # ---- sync dedup ----------------------------------------------------

    def test_sync_creates_and_dedups_by_health_id(self):
        from .health import _sync_user_workouts
        self._link_health()
        with mock.patch("custom_user.health._fetch_workouts", return_value=[self._ow_payload()]):
            first = _sync_user_workouts(self.user)
            second = _sync_user_workouts(self.user)

        self.assertEqual(first["created"], 1)
        self.assertEqual(second["created"], 0)
        self.assertEqual(second["updated"], 1)
        self.assertEqual(Workout.objects.filter(health_id="9f1c2a34-0000-4aaa-bbbb-111122223333").count(), 1)

    def test_sync_skips_cross_provider_duplicate(self):
        from .health import _sync_user_workouts
        Workout.objects.create(
            user=self.user, sport_type="Run", start_datetime=self.start,
            duration=self.duration, intensity_category=2, strava_id=112233,
        )
        self._link_health()
        with mock.patch("custom_user.health._fetch_workouts", return_value=[self._ow_payload()]):
            result = _sync_user_workouts(self.user)

        self.assertEqual(result["created"], 0)
        self.assertEqual(result["duplicates_skipped"], 1)
        self.assertEqual(Workout.objects.filter(user=self.user).count(), 1)

    # ---- link / unlink views -------------------------------------------

    def test_link_view_unconfigured_returns_503(self):
        from .health import HealthConfigError
        self.client.force_authenticate(self.user)
        with mock.patch("custom_user.health.generate_invitation", side_effect=HealthConfigError):
            response = self.client.post("/api/health/link/")
        self.assertEqual(response.status_code, 503)

    def test_link_view_returns_invitation_and_sets_source(self):
        # The mocked generate_invitation stands in for the real one,
        # which also creates the OW user and stores health_user_id.
        self.user.health_user_id = "11111111-2222-3333-4444-555555555555"
        self.user.save()
        self.client.force_authenticate(self.user)
        invitation = {"code": "ABC-DEF", "host": "https://health.example.com", "expires_at": "2026-08-05T00:00:00Z"}
        with mock.patch("custom_user.health.generate_invitation", return_value=invitation), \
                mock.patch("custom_user.health.sync_health") as sync_task:
            response = self.client.post("/api/health/link/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["code"], "ABC-DEF")
        self.user.refresh_from_db()
        self.assertEqual(self.user.activity_source, "health")
        # Health is the only linked provider -> initial import is queued.
        sync_task.delay.assert_called_once()

    def test_link_view_no_initial_import_when_other_source_active(self):
        self.user.strava_refresh_token = "gAAAAAencrypted"
        self.user.activity_source = "strava"
        self.user.save()
        self.client.force_authenticate(self.user)
        invitation = {"code": "ABC-DEF", "host": "https://health.example.com", "expires_at": None}
        with mock.patch("custom_user.health.generate_invitation", return_value=invitation), \
                mock.patch("custom_user.health.sync_health") as sync_task:
            response = self.client.post("/api/health/link/")

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        # Strava stays the source; linking a second provider never flips it.
        self.assertEqual(self.user.activity_source, "strava")
        sync_task.delay.assert_not_called()

    def test_unlink_clears_fields_and_stale_source(self):
        self._link_health()
        self.user.activity_source = "health"
        self.user.health_last_synced_at = timezone.now()
        self.user.save()
        self.client.force_authenticate(self.user)

        response = self.client.post("/api/health/unlink/")
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.health_user_id)
        self.assertIsNone(self.user.health_last_synced_at)
        self.assertIsNone(self.user.activity_source)

    def test_sync_view_blocked_when_other_source_selected(self):
        self.user.strava_refresh_token = "gAAAAAencrypted"
        self._link_health()
        self.user.activity_source = "strava"
        self.user.save()
        self.client.force_authenticate(self.user)

        response = self.client.get("/api/health/sync/")
        self.assertEqual(response.status_code, 400)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class HealthOwAuthTests(TestCase):
    """Developer-JWT auth against Open Wearables: login caching, 401
    relogin retry, and adopting an existing OW user on 409."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.welcome_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        self.user = CustomUser.objects.create_user(
            email="owauth@example.com", password="test-pw", first_name="Owa", last_name="",
        )
        self.cfg = {
            "base_url": "https://ow.example.com",
            "developer_email": "admin@example.com",
            "developer_password": "secret",
            "enabled": True,
        }

    def _login_response(self, token="jwt-1"):
        resp = mock.Mock()
        resp.status_code = 200
        resp.json.return_value = {"access_token": token, "expires_in": 3600}
        return resp

    def test_developer_token_is_cached(self):
        from .health import _developer_token
        with mock.patch("custom_user.health.requests.post", return_value=self._login_response()) as mock_post:
            self.assertEqual(_developer_token(self.cfg), "jwt-1")
            self.assertEqual(_developer_token(self.cfg), "jwt-1")  # cache hit
        self.assertEqual(mock_post.call_count, 1)

    def test_request_relogs_in_once_on_401(self):
        from .health import _ow_request
        login = self._login_response()
        unauthorized = mock.Mock(status_code=401)
        ok = mock.Mock()
        ok.status_code = 200
        ok.json.return_value = {"ok": True}
        with mock.patch("site_settings.models.resolve_health_settings", return_value=self.cfg), \
                mock.patch("custom_user.health.requests.post", return_value=login) as mock_post, \
                mock.patch("custom_user.health.requests.request", side_effect=[unauthorized, ok]) as mock_req:
            # First call uses a stale cached token -> 401 -> fresh login -> retry.
            from django.core.cache import cache
            cache.set(f"health_developer_jwt_{self.cfg['base_url']}_{self.cfg['developer_email']}", "stale", 3600)
            result = _ow_request("GET", "/users")
        self.assertEqual(result, {"ok": True})
        self.assertEqual(mock_req.call_count, 2)
        self.assertEqual(mock_post.call_count, 1)

    def test_ensure_user_adopts_existing_on_409(self):
        from .health import ensure_health_user
        adopted = {"data": [{"id": "aaaa-bbbb"}]}
        with mock.patch("custom_user.health._ow_request", side_effect=[{"_conflict": True}, adopted]) as mock_req:
            health_user_id = ensure_health_user(self.user)
        self.assertEqual(health_user_id, "aaaa-bbbb")
        self.user.refresh_from_db()
        self.assertEqual(self.user.health_user_id, "aaaa-bbbb")
        # POST /users then GET /users?email=...
        self.assertEqual(mock_req.call_args_list[0].args[:2], ("POST", "/users"))
        self.assertEqual(mock_req.call_args_list[1].args[:2], ("GET", "/users"))

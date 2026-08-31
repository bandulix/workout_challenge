import datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from custom_user.models import CustomUser

from .release_notes import get_release_notes, parse_release_notes


SAMPLE = """# Changelog

All notable changes.

## [Unreleased]

### Added
- **Coach threads** — participants can `reply` to coach messages.
- Small thing.

### Fixed
- **A nasty bug** — it broke everything.

## [0.9.0] - 2026-01-01

### Added
- Ancient history.
"""


class ParseReleaseNotesTests(TestCase):
    """The popup's notes come from the first ## [...] section of
    CHANGELOG.md, shaped for a small screen."""

    def test_unreleased_section_becomes_latest_changes(self):
        notes = parse_release_notes(SAMPLE)
        self.assertEqual(notes["heading"], "Latest changes")

    def test_sections_and_items_are_parsed_and_markdown_stripped(self):
        notes = parse_release_notes(SAMPLE)
        titles = [s["title"] for s in notes["sections"]]
        self.assertEqual(titles, ["Added", "Fixed"])
        self.assertEqual(notes["sections"][0]["items"][0], "Coach threads — participants can reply to coach messages.")
        self.assertNotIn("**", str(notes["sections"]))
        self.assertNotIn("`", str(notes["sections"]))

    def test_version_heading_wins_when_present(self):
        text = SAMPLE.replace("## [Unreleased]", "## [1.2.3] - 2026-08-01", 1)
        notes = parse_release_notes(text)
        self.assertEqual(notes["heading"], "1.2.3")

    def test_empty_unreleased_falls_through_to_version(self):
        text = (
            "# Changelog\n\n## [Unreleased]\n\n"
            "## [0.38.0] - 2026-08-22\n\n### Added\n- Arcade.\n"
        )
        notes = parse_release_notes(text)
        self.assertEqual(notes["heading"], "0.38.0")
        self.assertEqual(notes["sections"][0]["items"][0], "Arcade.")

    def test_item_cap_and_truncated_flag(self):
        text = "## [Unreleased]\n\n### Added\n" + "\n".join(f"- Item {i}" for i in range(30))
        notes = parse_release_notes(text)
        total = sum(len(s["items"]) for s in notes["sections"])
        self.assertEqual(total, 12)
        self.assertTrue(notes["truncated"])

    def test_empty_and_garbage_input(self):
        self.assertEqual(parse_release_notes(""), {"heading": "", "sections": [], "truncated": False})
        self.assertEqual(parse_release_notes("no headings here"), {"heading": "", "sections": [], "truncated": False})

    def test_missing_changelog_file_returns_empty_notes(self):
        from workout_challenge import release_notes
        with mock.patch.object(release_notes, "CHANGELOG_PATH") as fake:
            fake.stat.side_effect = OSError("missing")
            release_notes._cache.update({"mtime": None, "notes": None})
            self.assertEqual(get_release_notes(), {"heading": "", "sections": [], "truncated": False})


# DRF throttling reads the Django cache - LocMem so tests need no Redis.
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class TokenThrottleSplitTests(TestCase):
    """token/refresh must NOT share the tight 'auth' bucket with password
    login: the app refreshes once per access-token lifetime (5 min ->
    ~12/hour per foreground device), and per-IP budgets are shared behind
    carrier-grade NAT, so 30/hour logged active users out (the Android
    "seems disconnected after a while" bug)."""

    def setUp(self):
        # User creation fires welcome-email/point-recalc Celery plumbing -
        # no-op it (same pattern as the custom_user test suites).
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        # The class-level LocMem cache instance is reused across test
        # methods of this class - start each test with a clean history.
        cache.clear()
        self.user = CustomUser.objects.create_user(
            email="throttle@example.com", password="Sup3r-Secret!Pass", first_name="T",
        )

    def test_scopes_are_split(self):
        from .urls import ThrottledTokenObtainPairView, ThrottledTokenRefreshView
        self.assertEqual(ThrottledTokenObtainPairView.throttle_scope, "auth")
        self.assertEqual(ThrottledTokenRefreshView.throttle_scope, "auth_refresh")

    def test_refresh_throttles_independently_of_login(self):
        # SimpleRateThrottle.THROTTLE_RATES is bound once at import time,
        # so patching api_settings/REST_FRAMEWORK has no effect here -
        # patch the class attribute directly (as DRF's own tests do).
        from rest_framework.throttling import SimpleRateThrottle
        rates = {**SimpleRateThrottle.THROTTLE_RATES, "auth_refresh": "1/hour"}
        with mock.patch.object(SimpleRateThrottle, "THROTTLE_RATES", rates):
            login = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
            self.assertEqual(login.status_code, 200, login.content)
            first = self.client.post("/api/token/refresh/", {"refresh": login.json()["refresh"]})
            self.assertEqual(first.status_code, 200, first.content)
            # Second refresh within the hour exceeds the test rate...
            second = self.client.post("/api/token/refresh/", {"refresh": first.json()["refresh"]})
            self.assertEqual(second.status_code, 429)
            # ...while password login lives in its own bucket, unaffected.
            again = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
            self.assertEqual(again.status_code, 200, again.content)

    def test_refresh_rotates_and_rejects_old_token(self):
        login = self.client.post("/api/token/", {"email": "throttle@example.com", "password": "Sup3r-Secret!Pass"})
        self.assertEqual(login.status_code, 200, login.content)
        refresh = login.json()["refresh"]
        rotated = self.client.post("/api/token/refresh/", {"refresh": refresh})
        self.assertEqual(rotated.status_code, 200, rotated.content)
        self.assertTrue(rotated.json()["access"])
        # ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION: reuse is dead.
        reuse = self.client.post("/api/token/refresh/", {"refresh": refresh})
        self.assertEqual(reuse.status_code, 401)


# DRF throttling + the sport-factor cache read the Django cache - LocMem.
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class SportPointsFactorTests(TestCase):
    """Admin-editable per-activity-type point multipliers: neutral by
    default, applied by the scorer, and editing them re-scores existing
    points rows (raw + capped) and enqueues the cap recalc."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            self.addCleanup(patcher.stop)
            patcher.start()
        # The class-level LocMem cache instance is reused across test
        # methods of this class - start each test with a clean state.
        cache.clear()
        self.user = CustomUser.objects.create_user(
            email="factors@example.com", password="Sup3r-Secret!Pass", first_name="Fay",
        )

    @staticmethod
    def _goal(metric="min", goal=150):
        from decimal import Decimal
        goal_obj = mock.Mock()
        goal_obj.metric = metric
        goal_obj.goal = Decimal(str(goal))
        return goal_obj

    @staticmethod
    def _workout(sport_type="Run", minutes=30, kcal=None, distance=None):
        workout = mock.Mock()
        workout.sport_type = sport_type
        workout.duration = datetime.timedelta(minutes=minutes)
        workout.kcal = kcal
        workout.distance = distance
        return workout

    @staticmethod
    def _user_mock():
        from decimal import Decimal
        user = mock.Mock()
        user.scaling_kcal = Decimal("1")
        user.scaling_distance = Decimal("1")
        return user

    def test_default_factor_is_neutral(self):
        from competition.scorer import _calculate_points_raw
        # 30 min of a 150-min goal = 20 points; no factors configured.
        self.assertEqual(
            _calculate_points_raw(self._goal(), self._workout(), self._user_mock()),
            20.0,
        )

    def test_factor_multiplies_points(self):
        from competition.scorer import _calculate_points_raw
        self.assertEqual(
            _calculate_points_raw(self._goal(), self._workout(), self._user_mock(), factors={"Run": 2.0}),
            40.0,
        )
        # Unknown sport types stay neutral even when factors exist.
        self.assertEqual(
            _calculate_points_raw(self._goal(), self._workout(sport_type="Swim"), self._user_mock(), factors={"Run": 2.0}),
            20.0,
        )

    def test_factor_from_site_settings_is_applied(self):
        from competition.scorer import _calculate_points_raw
        from site_settings.models import SiteSettings
        solo = SiteSettings.get_solo()
        solo.points_sport_factors = {"Run": 2.0}
        solo.save()
        self.assertEqual(
            _calculate_points_raw(self._goal(), self._workout(), self._user_mock()),
            40.0,
        )

    def test_factor_edit_rescores_existing_rows(self):
        import datetime as dt
        from django.utils import timezone
        from competition.models import Competition, Points
        from custom_user.models import RecalcRequest
        from site_settings.models import SiteSettings
        from workouts.models import Workout

        today = timezone.localdate()
        competition = Competition.objects.create(
            owner=self.user, name="Factor Cup",
            start_date=today - dt.timedelta(days=1), end_date=today + dt.timedelta(days=7),
        )
        goal = competition.activitygoal_set.get(metric="min")  # default "Exercise" goal: 150 min/week
        workout = Workout.objects.create(
            user=self.user, sport_type="Run",
            start_datetime=timezone.now().replace(microsecond=0),
            duration=dt.timedelta(minutes=30), intensity_category=2,
        )
        row = Points.objects.get(goal=goal, workout=workout)
        self.assertEqual(float(row.points_raw), 20.0)

        # Admin triples Run points -> existing rows re-score immediately.
        solo = SiteSettings.get_solo()
        solo.points_sport_factors = {"Run": 3.0}
        solo.save()

        row.refresh_from_db()
        self.assertEqual(float(row.points_raw), 60.0)
        self.assertEqual(float(row.points_capped), 60.0)
        self.assertTrue(RecalcRequest.objects.filter(user=self.user, goal=goal).exists())

    def test_factors_endpoint_requires_auth_and_lists_all_types(self):
        from workouts.models import SPORT_TYPES
        anon = self.client.get("/api/points-factors/")
        self.assertIn(anon.status_code, (401, 403))
        # JWT-only API (no session auth) - authenticate via token.
        login = self.client.post("/api/token/", {"email": "factors@example.com", "password": "Sup3r-Secret!Pass"})
        self.assertEqual(login.status_code, 200, login.content)
        resp = self.client.get("/api/points-factors/", HTTP_AUTHORIZATION=f"Bearer {login.json()['access']}")
        self.assertEqual(resp.status_code, 200)
        factors = resp.json()["factors"]
        self.assertEqual(set(factors.keys()), {key for key, _label in SPORT_TYPES})
        self.assertTrue(all(v == 1.0 for v in factors.values()))


# DRF throttling reads the Django cache - LocMem so tests need no Redis.
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ReleaseVersionEndpointTests(TestCase):
    """GET /api/version/ is public (the popup also works logged-out) and
    returns the release version plus the parsed notes."""

    def test_anonymous_gets_version_and_changelog_shape(self):
        response = self.client.get("/api/version/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("version", data)
        self.assertIn("changelog", data)
        self.assertIn("heading", data["changelog"])
        self.assertIn("sections", data["changelog"])

    def test_version_defaults_to_dev(self):
        response = self.client.get("/api/version/")
        self.assertEqual(response.json()["version"], "dev")

    def test_apk_stamp_is_included_when_published(self):
        import json
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            downloads = Path(tmp) / "downloads"
            downloads.mkdir()
            (downloads / "apk-version.json").write_text(
                json.dumps({"versionName": "0.52.0", "versionCode": 156, "url": "https://evil.example/x.apk"}),
                encoding="utf-8",
            )
            with override_settings(DATA_DIR=Path(tmp)):
                response = self.client.get("/api/version/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["apk"], {
            "versionName": "0.52.0",
            "versionCode": 156,
            "url": "/download/workout-challenge.apk",
        })


class ApkVersionEndpointTests(TestCase):
    """GET /api/apk-version/ is the CORS JSON copy of apk-version.json."""

    def test_missing_file_is_404(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp, override_settings(DATA_DIR=Path(tmp)):
            response = self.client.get("/api/apk-version/")
        self.assertEqual(response.status_code, 404)

    def test_published_stamp_is_public_json(self):
        import json
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            downloads = Path(tmp) / "downloads"
            downloads.mkdir()
            (downloads / "apk-version.json").write_text(
                json.dumps({"versionName": "0.52.0", "versionCode": "156"}),
                encoding="utf-8",
            )
            with override_settings(DATA_DIR=Path(tmp)):
                response = self.client.get("/api/apk-version/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "versionName": "0.52.0",
            "versionCode": 156,
            "url": "/download/workout-challenge.apk",
        })

    def test_junk_file_is_404(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            downloads = Path(tmp) / "downloads"
            downloads.mkdir()
            (downloads / "apk-version.json").write_text("not-json", encoding="utf-8")
            with override_settings(DATA_DIR=Path(tmp)):
                response = self.client.get("/api/apk-version/")
        self.assertEqual(response.status_code, 404)


class ApiNoStoreMiddlewareTests(TestCase):
    """API responses carry no-store headers: the Android WebView's disk
    cache survives restarts and heuristically served stale GETs (the
    request then never reaches the server - invisible in nginx logs).
    Only /api/ is affected; static assets keep their long caching."""

    def test_api_responses_are_no_store(self):
        response = self.client.get("/api/version/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["Pragma"], "no-cache")

    def test_non_api_paths_untouched(self):
        response = self.client.get("/")
        self.assertNotIn("no-store", response.get("Cache-Control", ""))


class BlockPublicMediaMiddlewareTests(TestCase):
    """Guessing /media/<filename> must not stream an upload, even if
    Django's runserver or a future static() mapping would have."""

    def test_media_path_is_404(self):
        response = self.client.get("/media/profile_pics/secret.jpg")
        self.assertEqual(response.status_code, 404)

    def test_protected_media_path_is_404_without_accel(self):
        response = self.client.get("/protected-media/profile_pics/secret.jpg")
        self.assertEqual(response.status_code, 404)

    def test_api_picture_prefix_is_not_blocked(self):
        response = self.client.get("/api/user/1/picture/")
        self.assertNotEqual(response.status_code, 404)


class ThumbFilePermissionTests(TestCase):
    """Avatar/card thumbs are served by nginx via X-Accel-Redirect.
    mkstemp leaves 0600; nginx then 403s and CrowdSec http-probing bans
    the client after a handful of distinct /picture/?size= URLs."""

    def _jpeg_field(self):
        from io import BytesIO
        from django.core.files.base import ContentFile
        from django.core.files.storage import default_storage
        from PIL import Image

        buf = BytesIO()
        Image.new("RGB", (32, 32), (40, 80, 120)).save(buf, format="JPEG")
        name = default_storage.save("perm_src.jpg", ContentFile(buf.getvalue()))

        class Field:
            def __init__(self, stored):
                self.name = stored
                self.storage = default_storage
                self._fp = None

            def open(self, mode="rb"):
                self._fp = default_storage.open(self.name, mode)
                return self

            def read(self, *args, **kwargs):
                return self._fp.read(*args, **kwargs)

            def seek(self, *args, **kwargs):
                return self._fp.seek(*args, **kwargs)

            def tell(self, *args, **kwargs):
                return self._fp.tell(*args, **kwargs)

        return Field(name)

    def test_new_thumb_is_world_readable(self):
        from pathlib import Path
        from django.conf import settings
        from workout_challenge.images import _avatar_thumb_rel

        rel = _avatar_thumb_rel(self._jpeg_field())
        self.assertTrue(rel)
        mode = (Path(settings.MEDIA_ROOT) / rel).stat().st_mode & 0o777
        self.assertEqual(mode, 0o644, oct(mode))

    def test_existing_0600_thumb_is_repaired(self):
        import os
        from pathlib import Path
        from django.conf import settings
        from workout_challenge.images import _avatar_thumb_rel

        field = self._jpeg_field()
        rel = _avatar_thumb_rel(field)
        dest = Path(settings.MEDIA_ROOT) / rel
        os.chmod(dest, 0o600)
        again = _avatar_thumb_rel(field)
        self.assertEqual(again, rel)
        mode = dest.stat().st_mode & 0o777
        self.assertEqual(mode, 0o644, oct(mode))

    def test_thumb_dir_0700_is_repaired(self):
        import os
        from pathlib import Path
        from django.conf import settings
        from workout_challenge.images import _avatar_thumb_rel, _nginx_can_read

        rel = _avatar_thumb_rel(self._jpeg_field())
        dest = Path(settings.MEDIA_ROOT) / rel
        os.chmod(dest.parent, 0o700)
        again = _avatar_thumb_rel(self._jpeg_field())
        self.assertTrue(again)
        self.assertEqual(dest.parent.stat().st_mode & 0o001, 0o001)
        self.assertTrue(_nginx_can_read(dest))

    def test_missing_file_is_204_not_404(self):
        from pathlib import Path
        from django.conf import settings
        from django.http import HttpRequest
        from workout_challenge.images import protected_media_response

        field = self._jpeg_field()
        (Path(settings.MEDIA_ROOT) / field.name).unlink()
        request = HttpRequest()
        request.META = {}
        response = protected_media_response(field, request=request, size="avatar")
        self.assertEqual(response.status_code, 204)

    def test_0600_original_is_repaired_and_accel(self):
        import os
        from pathlib import Path
        from django.conf import settings
        from django.http import HttpRequest
        from django.test import override_settings
        from workout_challenge.images import protected_media_response

        field = self._jpeg_field()
        dest = Path(settings.MEDIA_ROOT) / field.name
        os.chmod(dest, 0o600)
        request = HttpRequest()
        request.META = {}
        with override_settings(DEBUG=False):
            response = protected_media_response(field, request=request)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get("X-Accel-Redirect", "").endswith(field.name))
        self.assertEqual(dest.stat().st_mode & 0o777, 0o644)

    def test_tmp_is_644_before_replace(self):
        import os
        from unittest.mock import patch
        from workout_challenge.images import _avatar_thumb_rel

        seen = []
        real_replace = os.replace

        def spy_replace(src, dst):
            seen.append(os.stat(src).st_mode & 0o777)
            return real_replace(src, dst)

        with patch("os.replace", side_effect=spy_replace):
            rel = _avatar_thumb_rel(self._jpeg_field())
        self.assertTrue(rel)
        self.assertEqual(seen, [0o644])

    def test_crowdsec_burst_of_unreadable_pictures_is_not_4xx(self):
        """http-probing bans after ~6 distinct 400/403/404s in a few seconds."""
        import os
        from pathlib import Path
        from django.conf import settings
        from django.http import HttpRequest
        from django.test import override_settings
        from workout_challenge.images import protected_media_response

        request = HttpRequest()
        request.META = {}
        codes = []
        with override_settings(DEBUG=False):
            for _ in range(8):
                field = self._jpeg_field()
                dest = Path(settings.MEDIA_ROOT) / field.name
                os.chmod(dest, 0o600)
                try:
                    os.chmod(dest.parent, 0o700)
                except OSError:
                    pass
                response = protected_media_response(field, request=request, size="avatar")
                codes.append(response.status_code)
        self.assertTrue(codes)
        self.assertTrue(all(code in (200, 204, 304) for code in codes), codes)
        self.assertFalse(any(code in (400, 403, 404) for code in codes), codes)

    def test_unreadable_after_chmod_fail_streams_instead_of_accel(self):
        import os
        from pathlib import Path
        from django.conf import settings
        from django.http import HttpRequest
        from django.test import override_settings
        from unittest.mock import patch
        from workout_challenge.images import protected_media_response

        field = self._jpeg_field()
        dest = Path(settings.MEDIA_ROOT) / field.name
        os.chmod(dest, 0o600)
        request = HttpRequest()
        request.META = {}
        with override_settings(DEBUG=False), patch(
            "workout_challenge.images.os.chmod", side_effect=OSError,
        ):
            response = protected_media_response(field, request=request)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("X-Accel-Redirect", response)
        self.assertTrue(response.streaming)


class HeicUploadTests(TestCase):
    """iPhone and Galaxy camera rolls default to HEIC. Pillow alone cannot
    open that container; pillow-heif must be registered and the upload
    re-encoded to JPEG like every other bitmap."""

    def _heic_bytes(self):
        from io import BytesIO
        from PIL import Image
        from pillow_heif import register_heif_opener

        register_heif_opener()
        buf = BytesIO()
        Image.new("RGB", (8, 6), (220, 40, 40)).save(buf, format="HEIF")
        return buf.getvalue()

    def test_heic_reencodes_to_jpeg(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from workout_challenge.images import validate_and_reencode_image

        uploaded = SimpleUploadedFile("IMG_0001.heic", self._heic_bytes(), content_type="image/heic")
        out = validate_and_reencode_image(uploaded)
        self.assertTrue(out.name.lower().endswith(".jpg"))
        self.assertEqual(out.content_type, "image/jpeg")
        self.assertGreater(out.size, 0)
        out.seek(0)
        from PIL import Image
        with Image.open(out) as img:
            self.assertEqual(img.format, "JPEG")
            self.assertEqual(img.size, (8, 6))

    def test_heif_content_type_is_also_accepted(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from workout_challenge.images import validate_and_reencode_image

        uploaded = SimpleUploadedFile("shot.heif", self._heic_bytes(), content_type="image/heif")
        out = validate_and_reencode_image(uploaded)
        self.assertEqual(out.content_type, "image/jpeg")

    def test_profile_api_accepts_heic(self):
        from rest_framework.test import APIClient
        from django.core.files.uploadedfile import SimpleUploadedFile
        from custom_user.models import CustomUser

        user = CustomUser.objects.create_user(
            email="heic@example.com", password="Sup3r-Secret!Pass", first_name="H", last_name="E",
        )
        client = APIClient()
        client.force_authenticate(user)
        upload = SimpleUploadedFile("IMG_0001.heic", self._heic_bytes(), content_type="image/heic")
        response = client.patch("/api/user/me/", {"profile_picture_upload": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["profile_picture"])
        user.refresh_from_db()
        self.assertTrue(user.profile_picture.name.endswith(".jpg"))

    def test_html_and_svg_are_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.exceptions import ValidationError
        from workout_challenge.images import validate_and_reencode_image

        html = SimpleUploadedFile("x.html", b"<html><script>alert(1)</script></html>", content_type="text/html")
        with self.assertRaises(ValidationError):
            validate_and_reencode_image(html)
        svg = SimpleUploadedFile(
            "x.svg",
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            content_type="image/svg+xml",
        )
        with self.assertRaises(ValidationError):
            validate_and_reencode_image(svg)


class OriginHostnamesTests(TestCase):
    def test_ports_are_stripped_for_allowed_hosts(self):
        from workout_challenge.settings import origin_hostnames
        self.assertEqual(
            origin_hostnames(["http://localhost:3000", "https://example.com:443", "http://127.0.0.1"]),
            ["localhost", "example.com", "127.0.0.1"],
        )

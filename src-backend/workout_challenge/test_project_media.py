import datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from custom_user.models import CustomUser

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

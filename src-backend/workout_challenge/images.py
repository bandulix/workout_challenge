"""Shared upload validation: trust pixels, not the client Content-Type."""

import hashlib
import os
from io import BytesIO
from pathlib import Path as _Path

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.http import FileResponse, Http404, HttpResponse
from django.utils.text import get_valid_filename
from rest_framework import serializers
from rest_framework.renderers import BaseRenderer

# Pillow's decompression-bomb ceiling (default ~179M px is huge; 40M is
# a 8k x 5k photo, well above any avatar/photo-post we accept).
_MAX_PIXELS = 40_000_000
_MAX_BYTES = 5 * 1024 * 1024
# After pixels decode, only these containers are accepted. SVG/HTML/PDF
# must never land in MEDIA_ROOT even if a Pillow plugin can open them.
_ALLOWED_FORMATS = frozenset({"JPEG", "PNG", "GIF", "WEBP", "BMP", "TIFF", "ICO", "HEIF", "HEIC"})

_heif_registered = False


def _ensure_heif_opener():
    """Register HEIC/HEIF so iPhone and Galaxy camera rolls open in Pillow."""
    global _heif_registered
    if _heif_registered:
        return
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass
    _heif_registered = True


def validate_and_reencode_image(uploaded, *, max_bytes=_MAX_BYTES, max_side=1920, field="image"):
    """Verify the bytes are an image and re-encode to strip metadata.

    Returns a new InMemoryUploadedFile (JPEG, or PNG when the source
    has alpha). Accepts HEIC/HEIF from iPhone and Galaxy. Raises
    serializers.ValidationError on anything else. ``uploaded is None``
    is passed through.
    """
    if uploaded is None:
        return None
    size = getattr(uploaded, "size", None)
    if size is not None and size > max_bytes:
        raise serializers.ValidationError("Image too large (max 5 MB).")

    try:
        from PIL import Image, ImageOps
    except ImportError as exc:  # pragma: no cover
        raise serializers.ValidationError("Image processing is unavailable.") from exc

    _ensure_heif_opener()
    Image.MAX_IMAGE_PIXELS = _MAX_PIXELS
    try:
        uploaded.seek(0)
        with Image.open(uploaded) as probe:
            probe.verify()
        uploaded.seek(0)
        image = Image.open(uploaded)
        image.load()
        fmt = (image.format or "").upper()
        if fmt not in _ALLOWED_FORMATS:
            raise serializers.ValidationError("File must be a valid image.")
        # iPhone/Galaxy HEIC (and JPEG) often store orientation in EXIF.
        image = ImageOps.exif_transpose(image) or image
    except serializers.ValidationError:
        raise
    except Exception as exc:
        raise serializers.ValidationError("File must be a valid image.") from exc

    has_alpha = image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    )
    if has_alpha:
        out = image.convert("RGBA")
        fmt, ext, content_type = "PNG", "png", "image/png"
        save_kwargs = {"optimize": True}
    else:
        out = image.convert("RGB")
        fmt, ext, content_type = "JPEG", "jpg", "image/jpeg"
        save_kwargs = {"quality": 85, "optimize": True}

    if max_side and max(out.size) > max_side:
        out.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    buf = BytesIO()
    out.save(buf, format=fmt, **save_kwargs)
    data = buf.getvalue()
    if len(data) > max_bytes:
        raise serializers.ValidationError("Image too large after processing (max 5 MB).")

    name = getattr(uploaded, "name", None) or f"upload.{ext}"
    stem = get_valid_filename(_Path(name).name.rsplit(".", 1)[0]) or "upload"
    stem = stem[:80]
    return InMemoryUploadedFile(
        ContentFile(data),
        field_name=getattr(uploaded, "field_name", None),
        name=f"{stem}.{ext}",
        content_type=content_type,
        size=len(data),
        charset=None,
    )


class ProtectedMediaRenderer(BaseRenderer):
    """Picture endpoints return a FileResponse, but DRF still negotiates
    Accept in ``initial()``. ``image/*`` (what a browser ``<img>``-style
    fetch sends) does not match JSONRenderer and used to 406 every
    avatar. This renderer matches any Accept; the view's FileResponse
    is returned as-is and this ``render`` is never used."""

    media_type = "*/*"
    format = "bin"
    charset = None

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data if data is not None else b""


PICTURE_MAX_AGE = 86400
CARD_MAX_SIDE = 800
AVATAR_MAX_SIDE = 256
CARD_JPEG_QUALITY = 70
AVATAR_JPEG_QUALITY = 72


def _safe_media_name(name):
    name = (name or "").replace("\\", "/")
    parts = name.split("/")
    if not name or name.startswith("/") or any(p in ("", ".", "..") for p in parts):
        raise Http404("No file.")
    return name


def _content_type_for(name):
    return (
        {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
        .get(_Path(name).suffix.lower())
        or "application/octet-stream"
    )


def _file_etag(file_field, variant="full"):
    name = getattr(file_field, "name", "") or ""
    try:
        mtime = file_field.storage.get_modified_time(name).timestamp()
    except Exception:
        mtime = 0
    return hashlib.md5(f"{name}:{mtime}:{variant}".encode()).hexdigest()


def _etag_matches(header, etag):
    if not header:
        return False
    want = etag.strip().strip('"')
    for part in header.split(","):
        token = part.strip()
        if token.startswith("W/"):
            token = token[2:].strip()
        token = token.strip('"')
        if token == want:
            return True
    return False


THUMB_CAP = 200
# mkstemp creates 0600. nginx (X-Accel-Redirect) runs as user `nginx`,
# not `app`, so a 0600 file 403s. CrowdSec http-probing treats a handful
# of distinct /picture/?size=… 403/404s as a scan and 24h-bans the IP.
# World-readable files + traversable dirs, and never 403/404 from nginx
# on a legitimate picture GET (204 if missing, FileResponse if nginx
# still could not read).
_THUMB_MODE = 0o644
_DIR_MODE = 0o755


def _ensure_world_readable(path):
    try:
        if path.stat().st_mode & 0o044 != 0o044:
            os.chmod(path, _THUMB_MODE)
    except OSError:
        pass


def _ensure_traversable(path):
    try:
        if path.stat().st_mode & 0o001 == 0:
            os.chmod(path, _DIR_MODE)
    except OSError:
        pass


def _prepare_media_for_nginx(path):
    """Make ``path`` readable and every MEDIA_ROOT ancestor traversable.

    nginx is not the ``app`` user. 0700 upload dirs and 0600 originals
    (legacy uploads, mkstemp thumbs before chmod) 403 X-Accel-Redirect.
    """
    from django.conf import settings

    try:
        media_root = _Path(settings.MEDIA_ROOT).resolve()
        resolved = path.resolve()
        resolved.relative_to(media_root)
    except (OSError, ValueError):
        return
    if resolved.is_file():
        _ensure_world_readable(resolved)
    current = resolved if resolved.is_dir() else resolved.parent
    try:
        while True:
            _ensure_traversable(current)
            if current == media_root:
                break
            parent = current.parent
            if parent == current:
                break
            current = parent
    except OSError:
        return


def _nginx_can_read(path):
    """True when user ``nginx`` (other) can traverse to and read ``path``."""
    from django.conf import settings

    try:
        if not path.is_file() or path.stat().st_mode & 0o004 == 0:
            return False
        media_root = _Path(settings.MEDIA_ROOT).resolve()
        current = path.parent
        while True:
            if current.stat().st_mode & 0o001 == 0:
                return False
            if current.resolve() == media_root:
                return True
            parent = current.parent
            if parent == current:
                return True
            current = parent
    except OSError:
        return False


def _prune_thumbs(folder):
    try:
        files = [p for p in folder.glob("*.jpg") if p.is_file() and ".tmp." not in p.name]
    except OSError:
        return
    extra = len(files) - THUMB_CAP
    if extra <= 0:
        return
    files.sort(key=lambda p: p.stat().st_mtime)
    for path in files[:extra]:
        try:
            path.unlink()
        except OSError:
            pass


def _thumb_rel(file_field, variant, max_side, quality):
    """JPEG derivative cached under MEDIA_ROOT/thumbs/."""
    import tempfile
    from django.conf import settings
    from PIL import Image, ImageOps

    etag = _file_etag(file_field, variant)
    rel = f"thumbs/{etag}.jpg"
    dest = _Path(settings.MEDIA_ROOT) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    _prepare_media_for_nginx(dest.parent)
    if dest.exists() and dest.stat().st_size > 0:
        _prepare_media_for_nginx(dest)
        return rel
    fd, tmp_name = tempfile.mkstemp(prefix=f"{etag}.", suffix=".jpg", dir=dest.parent)
    os.close(fd)
    tmp = _Path(tmp_name)
    try:
        file_field.open("rb")
        with Image.open(file_field) as image:
            image.load()
            image = ImageOps.exif_transpose(image) or image
            out = image.convert("RGB")
            out.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            out.save(tmp, format="JPEG", quality=quality, optimize=True)
        if tmp.stat().st_size <= 0:
            tmp.unlink(missing_ok=True)
            return None
        # chmod the tmp *before* replace so dest is never visible as 0600
        # (the previous window was enough for a parallel GET to 403).
        os.chmod(tmp, _THUMB_MODE)
        os.replace(tmp, dest)
        _prepare_media_for_nginx(dest)
    except Exception:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return None
    _prune_thumbs(dest.parent)
    return rel


def _card_thumb_rel(file_field):
    """JPEG ≤800px for feed cards."""
    return _thumb_rel(file_field, "card", CARD_MAX_SIDE, CARD_JPEG_QUALITY)


def _avatar_thumb_rel(file_field):
    """JPEG ≤256px for dock / list avatars."""
    return _thumb_rel(file_field, "avatar", AVATAR_MAX_SIDE, AVATAR_JPEG_QUALITY)


def _privacy_headers(response, etag):
    response["ETag"] = f'"{etag}"'
    response["Cache-Control"] = f"private, max-age={PICTURE_MAX_AGE}"
    response["X-Robots-Tag"] = "noindex, nofollow, noarchive, nosnippet"
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "same-origin"
    response["X-Frame-Options"] = "SAMEORIGIN"
    return response


def empty_picture_response():
    """Authenticated picture GET that has no bytes to send.

    CrowdSec http-probing 24h-bans after a handful of distinct
    400/403/404s. 204 is not one of those, and the UI already treats
    it as "no image".
    """
    response = HttpResponse(status=204)
    response["Cache-Control"] = "private, no-store"
    response["X-Robots-Tag"] = "noindex, nofollow, noarchive, nosnippet"
    return response


def serve_picture(file_field, *, request=None, size=None):
    if not file_field:
        return empty_picture_response()
    return protected_media_response(file_field, request=request, size=size)


def protected_media_response(file_field, *, request=None, size=None):
    """Authenticated-picture response: stream in DEBUG, X-Accel otherwise.

    Rejects path-traversal in the stored name so a poisoned ImageField
    cannot point nginx's internal alias outside MEDIA_ROOT.

    ``size="card"`` serves an 800px JPEG derivative (feed backdrops).
    ``size="avatar"`` serves a 256px JPEG (profile / persona rings).
    Private max-age + ETag let the APK disk-cache and WebView revalidate
    without re-downloading bytes. JWT still gates the first GET.

    CrowdSec http-probing counts distinct 400/403/404 on non-static
    paths. A missing or unreadable file must not become one of those:
    missing → 204, nginx cannot read → Django streams the bytes.
    """
    from django.conf import settings
    from urllib.parse import quote

    name = _safe_media_name(getattr(file_field, "name", ""))
    if size == "card":
        variant = "card"
    elif size == "avatar":
        variant = "avatar"
    else:
        variant = "full"
    etag = _file_etag(file_field, variant)

    serve_name = name
    content_type = _content_type_for(name)
    if variant == "card":
        rel = _card_thumb_rel(file_field)
        if rel:
            serve_name = rel
            content_type = "image/jpeg"
    elif variant == "avatar":
        rel = _avatar_thumb_rel(file_field)
        if rel:
            serve_name = rel
            content_type = "image/jpeg"

    path = _Path(settings.MEDIA_ROOT) / serve_name
    if not path.is_file():
        response = HttpResponse(status=204)
        return _privacy_headers(response, etag)

    _prepare_media_for_nginx(path)

    if request and _etag_matches(request.META.get("HTTP_IF_NONE_MATCH", ""), etag):
        response = HttpResponse(status=304)
        return _privacy_headers(response, etag)

    if settings.DEBUG or not _nginx_can_read(path):
        # DEBUG, or nginx would 403 (legacy 0600 / 0700 that chmod could
        # not fix): gunicorn runs as `app` and can still stream it.
        response = FileResponse(path.open("rb"), content_type=content_type)
    else:
        response = HttpResponse(content_type=content_type)
        response["X-Accel-Redirect"] = "/protected-media/" + quote(serve_name, safe="/")
    return _privacy_headers(response, etag)


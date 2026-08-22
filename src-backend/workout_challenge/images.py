"""Shared upload validation: trust pixels, not the client Content-Type."""

from io import BytesIO
from pathlib import Path as _Path

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.http import FileResponse, Http404, HttpResponse
from django.utils.text import get_valid_filename
from rest_framework import serializers

# Pillow's decompression-bomb ceiling (default ~179M px is huge; 40M is
# a 8k x 5k photo, well above any avatar/photo-post we accept).
_MAX_PIXELS = 40_000_000
_MAX_BYTES = 5 * 1024 * 1024


def validate_and_reencode_image(uploaded, *, max_bytes=_MAX_BYTES, max_side=1920, field="image"):
    """Verify the bytes are an image and re-encode to strip metadata.

    Returns a new InMemoryUploadedFile (JPEG, or PNG when the source
    has alpha). Raises serializers.ValidationError on anything else.
    ``uploaded is None`` is passed through.
    """
    if uploaded is None:
        return None
    size = getattr(uploaded, "size", None)
    if size is not None and size > max_bytes:
        raise serializers.ValidationError("Image too large (max 5 MB).")

    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover
        raise serializers.ValidationError("Image processing is unavailable.") from exc

    Image.MAX_IMAGE_PIXELS = _MAX_PIXELS
    try:
        uploaded.seek(0)
        with Image.open(uploaded) as probe:
            probe.verify()
        uploaded.seek(0)
        image = Image.open(uploaded)
        image.load()
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


def protected_media_response(file_field):
    """Authenticated-picture response: stream in DEBUG, X-Accel otherwise.

    Rejects path-traversal in the stored name so a poisoned ImageField
    cannot point nginx's internal alias outside MEDIA_ROOT.
    """
    from django.conf import settings

    name = (getattr(file_field, "name", "") or "").replace("\\", "/")
    parts = name.split("/")
    if not name or name.startswith("/") or any(p in ("", ".", "..") for p in parts):
        raise Http404("No file.")

    content_type = (
        {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
        .get(_Path(name).suffix.lower())
        or "application/octet-stream"
    )
    if settings.DEBUG:
        response = FileResponse(file_field.open("rb"), content_type=content_type)
    else:
        response = HttpResponse(content_type=content_type)
        response["X-Accel-Redirect"] = f"/protected-media/{name}"
    response["Cache-Control"] = "private, no-store"
    response["X-Robots-Tag"] = "noindex, nofollow, noarchive, nosnippet"
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    return response


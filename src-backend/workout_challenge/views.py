import json
from pathlib import Path

from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .release_notes import get_release_notes


def load_apk_version():
    """Published APK stamp from apk-version.json, or None if missing."""
    data_dir = Path(getattr(settings, "DATA_DIR", Path(settings.BASE_DIR) / "data"))
    path = data_dir / "downloads" / "apk-version.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    try:
        code = int(raw.get("versionCode") or 0)
    except (TypeError, ValueError):
        code = 0
    if code <= 0:
        return None
    return {
        "versionName": str(raw.get("versionName") or ""),
        "versionCode": code,
        "url": "/download/workout-challenge.apk",
    }


class ReleaseVersionView(APIView):
    """Current release version + its changelog for the "What's new" popup.

    Public on purpose: the popup also works on the logged-out welcome /
    login pages, and neither the version nor the changelog is sensitive.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        body = {
            "version": getattr(settings, "APP_VERSION", "dev"),
            "changelog": get_release_notes(),
        }
        apk = load_apk_version()
        if apk:
            body["apk"] = apk
        return Response(body)


class ApkVersionView(APIView):
    """Same stamp as /download/apk-version.json, as a CORS JSON API.

    Old Android WebViews fetch the nginx file. This exists so a new
    client can still learn the published versionCode if that file is
    missing or served as an attachment.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        data = load_apk_version()
        if not data:
            return Response(status=404)
        return Response(data)

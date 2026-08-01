"""Shared Fernet encryption for OAuth tokens stored at rest.

Used for both the Garmin token blob and the Strava refresh token. The
key is derived from ``GARMIN_TOKEN_KEY`` when set (kept as the generic
"token key" for backwards compatibility) and falls back to Django's
``SECRET_KEY``.
"""

import base64
import hashlib

from django.conf import settings


def _fernet():
    from cryptography.fernet import Fernet
    key_material = getattr(settings, "GARMIN_TOKEN_KEY", None) or settings.SECRET_KEY
    digest = hashlib.sha256(key_material.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_token(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_token(value: str) -> str:
    """Decrypt a Fernet-encrypted token.

    Legacy rows may still hold the plaintext token (written before
    encryption-at-rest was introduced); those are returned unchanged so
    existing linkages keep working until they are re-saved encrypted.
    """
    if not value:
        return value
    try:
        return _fernet().decrypt(value.encode()).decode()
    except Exception:  # noqa: BLE001 - InvalidToken or malformed value
        return value

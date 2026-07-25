"""VAPID keypair handling for Web Push.

Resolution order:
  1. ``VAPID_PUBLIC_KEY`` and ``VAPID_PRIVATE_KEY`` env vars (preferred
     for production - generate once with ``openssl`` or ``py_vapid``).
  2. A persisted keypair in ``DATA_DIR/vapid.json`` (auto-generated on
     first startup and reused across restarts).
  3. A freshly-generated keypair (development only).

The public key is safe to expose; the private key stays on the server.
"""

import json
import logging
import os
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

_VAPID_CACHE: dict | None = None
_DEFAULT_SUBJECT = "mailto:admin@example.com"


def _ensure_str(value) -> str:
    """Some ``py_vapid`` versions return ``bytes`` from ``*_pem()``."""
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return value


def _vapid_path() -> Path:
    data_dir = getattr(settings, "DATA_DIR", Path(settings.BASE_DIR) / "data")
    return Path(data_dir) / "vapid.json"


def ensure_vapid_keys():
    """Load or generate the VAPID keypair and expose them on Django settings."""
    global _VAPID_CACHE

    pub = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
    priv = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    subject = os.environ.get("VAPID_SUBJECT", _DEFAULT_SUBJECT).strip()

    if pub and priv:
        _VAPID_CACHE = {"public": pub, "private": priv, "subject": subject}
    else:
        path = _vapid_path()
        if path.is_file():
            try:
                with path.open() as f:
                    _VAPID_CACHE = json.load(f)
            except Exception as exc:
                logger.warning("Failed to read persisted VAPID keys: %s", exc)
                _VAPID_CACHE = None

        if not _VAPID_CACHE or not _VAPID_CACHE.get("public"):
            try:
                from py_vapid import Vapid  # type: ignore
                vapid = Vapid()
                vapid.generate_keys()
                _VAPID_CACHE = {
                    "public": _ensure_str(vapid.public_pem()),
                    "private": _ensure_str(vapid.private_pem()),
                    "subject": subject,
                }
                path.parent.mkdir(parents=True, exist_ok=True)
                # Write with mode 0o600 so the VAPID private key is not
                # world-readable on the host.
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w") as f:
                    json.dump(_VAPID_CACHE, f)
                os.chmod(path, 0o600)
                logger.info("Generated and persisted new VAPID keypair at %s", path)
            except ImportError:
                logger.error("py_vapid is not installed; push notifications will not work.")
                _VAPID_CACHE = {"public": "", "private": "", "subject": subject}

    settings.VAPID_PUBLIC_KEY = _VAPID_CACHE.get("public", "")
    settings.VAPID_PRIVATE_KEY = _VAPID_CACHE.get("private", "")
    settings.VAPID_SUBJECT = _VAPID_CACHE.get("subject", subject)


def get_vapid_public_key() -> str:
    """Public key for the browser to subscribe with."""
    if _VAPID_CACHE is None:
        ensure_vapid_keys()
    return _VAPID_CACHE.get("public", "") if _VAPID_CACHE else ""


def get_vapid_private_key() -> str:
    """Server-side private key - never expose via the API."""
    if _VAPID_CACHE is None:
        ensure_vapid_keys()
    return _VAPID_CACHE.get("private", "") if _VAPID_CACHE else ""


def get_vapid_subject() -> str:
    if _VAPID_CACHE is None:
        ensure_vapid_keys()
    return _VAPID_CACHE.get("subject", _DEFAULT_SUBJECT) if _VAPID_CACHE else _DEFAULT_SUBJECT
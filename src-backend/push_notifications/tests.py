import base64
import json
import tempfile
from pathlib import Path
from unittest import mock

from django.test import TestCase, override_settings

from . import vapid


def _decode_b64url(value: str) -> bytes:
    """Decode base64url the same way the browser's atob() flow does."""
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _fresh_pem_keypair():
    from py_vapid import Vapid

    v = Vapid()
    v.generate_keys()
    pub, priv = v.public_pem(), v.private_pem()
    if isinstance(pub, bytes):
        pub = pub.decode("utf-8")
    if isinstance(priv, bytes):
        priv = priv.decode("utf-8")
    return pub, priv


class VapidPublicKeyTests(TestCase):
    """Browsers need the raw 65-byte uncompressed EC point, base64url -
    a PEM public key makes atob() throw in the subscribe flow."""

    def setUp(self):
        vapid._VAPID_CACHE = None
        self.addCleanup(setattr, vapid, "_VAPID_CACHE", None)
        env_patcher = mock.patch.dict(
            "os.environ", {"VAPID_PUBLIC_KEY": "", "VAPID_PRIVATE_KEY": ""}
        )
        self.addCleanup(env_patcher.stop)
        env_patcher.start()

    def test_generated_public_key_is_browser_ready(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(DATA_DIR=Path(tmp)):
            key = vapid.get_vapid_public_key()

        self.assertNotIn("BEGIN", key)
        raw = _decode_b64url(key)
        self.assertEqual(len(raw), 65)
        self.assertEqual(raw[0], 4)  # uncompressed EC point marker

    def test_pem_public_key_is_converted(self):
        pub_pem, _ = _fresh_pem_keypair()

        key = vapid._public_to_b64url(pub_pem)

        self.assertNotIn("BEGIN", key)
        self.assertEqual(len(_decode_b64url(key)), 65)

    def test_b64url_public_key_passes_through(self):
        key = "B" * 87  # already the right shape
        self.assertEqual(vapid._public_to_b64url(key), key)

    def test_env_pem_keys_are_normalised(self):
        pub_pem, priv_pem = _fresh_pem_keypair()

        with mock.patch.dict(
            "os.environ",
            {"VAPID_PUBLIC_KEY": pub_pem, "VAPID_PRIVATE_KEY": priv_pem},
        ):
            vapid._VAPID_CACHE = None
            key = vapid.get_vapid_public_key()

        self.assertEqual(len(_decode_b64url(key)), 65)

    def test_persisted_pem_keypair_is_healed_and_rewritten(self):
        pub_pem, priv_pem = _fresh_pem_keypair()

        with tempfile.TemporaryDirectory() as tmp, override_settings(DATA_DIR=Path(tmp)):
            path = Path(tmp) / "vapid.json"
            path.write_text(
                json.dumps({"public": pub_pem, "private": priv_pem, "subject": "mailto:x@example.com"})
            )
            vapid._VAPID_CACHE = None

            key = vapid.get_vapid_public_key()

            self.assertEqual(len(_decode_b64url(key)), 65)
            healed = json.loads(path.read_text())
            self.assertEqual(healed["public"], key)
            self.assertEqual(healed["private"], priv_pem)  # private untouched

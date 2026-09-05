"""
Django settings for workout_challenge project.

Base settings live in settings_base.py. This module applies production
boot checks and the httpOnly refresh-cookie / HTTPS-link gates.
"""

from workout_challenge.settings_base import *  # noqa: F401,F403

import os
from workout_challenge.sec_hardening import (
    assert_distinct_operational_secrets,
    warn_cleartext_public_bind,
)

# Host bind for the published app port (compose APP_BIND). Used only for
# the cleartext-on-public-bind startup warning - the actual bind is
# applied by docker-compose's ports mapping.
APP_BIND = os.environ.get("APP_BIND", "127.0.0.1").strip() or "127.0.0.1"

assert_distinct_operational_secrets(
    debug=DEBUG,
    secret_key=SECRET_KEY,
    health_developer_password=HEALTH_DEVELOPER_PASSWORD,
)
warn_cleartext_public_bind(debug=DEBUG, main_host=MAIN_HOST, app_bind=APP_BIND)

# HTTPS gate for Garmin/Strava credential-link endpoints (issue #17).
_mw = "custom_user.https_link_middleware.RequireHttpsForLinkMiddleware"
if _mw not in MIDDLEWARE:
    try:
        _i = MIDDLEWARE.index("django.middleware.security.SecurityMiddleware") + 1
    except ValueError:
        _i = 0
    MIDDLEWARE = list(MIDDLEWARE)
    MIDDLEWARE.insert(_i, _mw)

# JWT refresh cookie (issue #19). Access stays in the JSON body
# (memory-only on the client). Refresh is httpOnly Secure so XSS cannot
# exfiltrate it from localStorage.
JWT_REFRESH_COOKIE_NAME = "wc_refresh"
JWT_REFRESH_COOKIE_PATH = "/api/token"
JWT_REFRESH_COOKIE_SECURE = not DEBUG
# Lax for local same-origin DEBUG; None for production so Capacitor
# WebViews (cross-origin to the API host) still send the cookie.
JWT_REFRESH_COOKIE_SAMESITE = "Lax" if DEBUG else "None"

# Native Capacitor clients send these on token obtain (X-WC-Client: native)
# so the backend can leave refresh in the JSON body for secure storage.
_cors_headers = list(globals().get("CORS_ALLOW_HEADERS") or [
    "accept",
    "authorization",
    "content-type",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
])
for _h in ("x-wc-client", "x-wc-requested-with"):
    if _h not in _cors_headers:
        _cors_headers.append(_h)
CORS_ALLOW_HEADERS = _cors_headers

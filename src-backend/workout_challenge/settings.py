"""
Django settings for workout_challenge project.

Security hardening (issues #17, #23) is applied at the bottom via
workout_challenge.sec_hardening after the base settings load.
"""

# Base settings (unchanged from main) live in settings_base so this file
# stays small enough for API updates while keeping the security gates
# reviewable in isolation.
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

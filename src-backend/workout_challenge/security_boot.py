"""Production boot hardening for operational secrets and HTTP bind.

Imported from settings.py so the checks run at Django startup.
"""
import logging
import os


def assert_distinct_operational_secrets(*, debug, secret_key, health_developer_password):
    """Refuse production boot when Flower/OW/Health passwords equal SECRET_KEY."""
    if debug:
        return
    offenders = []
    for name in ("FLOWER_PASSWORD", "OW_ADMIN_PASSWORD", "HEALTH_DEVELOPER_PASSWORD"):
        val = os.environ.get(name, "").strip()
        if val and val == secret_key:
            offenders.append(name)
    if health_developer_password and health_developer_password == secret_key:
        if "HEALTH_DEVELOPER_PASSWORD" not in offenders:
            offenders.append("HEALTH_DEVELOPER_PASSWORD")
    if offenders:
        raise RuntimeError(
            f"{', '.join(offenders)} must not equal SECRET_KEY in production. "
            "Set distinct Flower / Open Wearables / Health developer passwords "
            "(see .env.example)."
        )


def warn_if_cleartext_public_bind(*, debug, main_host, app_bind):
    """Warn when MAIN_HOST is http:// and APP_BIND is publicly reachable."""
    if debug:
        return
    loopback = {"127.0.0.1", "localhost", "::1"}
    if main_host.lower().startswith("http://") and app_bind not in loopback:
        logging.getLogger("workout_challenge.settings").warning(
            "MAIN_HOST=%s is cleartext HTTP while APP_BIND=%s is publicly reachable. "
            "Prefer HTTPS behind a reverse proxy and APP_BIND=127.0.0.1 "
            "(see issue #17 / .env.example).",
            main_host,
            app_bind,
        )

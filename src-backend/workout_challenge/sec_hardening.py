"""Production security boot checks for Workout Challenge (issues #17, #23)."""
import logging
import os

logger = logging.getLogger(__name__)


def assert_distinct_operational_secrets(*, debug: bool, secret_key: str, health_developer_password: str = "") -> None:
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


def warn_cleartext_public_bind(*, debug: bool, main_host: str, app_bind: str) -> None:
    """Warn when MAIN_HOST is http:// while APP_BIND is publicly reachable."""
    loopback = {"127.0.0.1", "localhost", "::1"}
    if (
        not debug
        and main_host.lower().startswith("http://")
        and app_bind not in loopback
    ):
        logger.warning(
            "MAIN_HOST=%s is cleartext HTTP while APP_BIND=%s is publicly reachable. "
            "Prefer HTTPS behind a reverse proxy and APP_BIND=127.0.0.1 "
            "(see issue #17 / .env.example).",
            main_host,
            app_bind,
        )


def warn_debug_with_public_hosts(*, debug: bool, allowed_hosts) -> None:
    """Warn loudly when DEBUG=true is combined with a non-local hostname.

    DEBUG silently switches off several controls at once (Secure cookie
    flags, the HTTPS link gate, the distinct-secret assertion, and it
    enables the insecure fallback SECRET_KEY), so a "quick troubleshooting"
    toggle on a reachable deployment must not go unnoticed.
    """
    if not debug:
        return
    local = {"127.0.0.1", "localhost", "::1", "0.0.0.0", "testserver"}  # noqa: S104 - allow-list of local names, not a bind
    public = [h for h in allowed_hosts if h and h not in local]
    if public:
        # Log a count only — never the host list (CodeQL
        # py/clear-text-logging-sensitive-data; host config can sit next to
        # other secrets in the process environment).
        logger.warning(
            "DEBUG=true with %d non-local ALLOWED_HOSTS entr%s - security "
            "controls are relaxed. Never run a reachable deployment with "
            "DEBUG enabled.",
            len(public),
            "y" if len(public) == 1 else "ies",
        )

import logging
import os
from django.conf import settings

logger = logging.getLogger(__name__)
from django.core.mail import get_connection
from django.core.mail.message import EmailMultiAlternatives
from django.test.utils import override_settings



def _effective_email_settings():
    """Resolve the SMTP settings to apply for the next email send.

    Reads from SiteSettings (DB) with env-var fallback, so admins can
    change the SMTP server at runtime without restarting workers.
    """
    from site_settings.models import resolve_email_settings
    cfg = resolve_email_settings()
    overrides = {}
    if cfg["host"]:
        overrides["EMAIL_HOST"] = cfg["host"]
    if cfg["port"]:
        overrides["EMAIL_PORT"] = cfg["port"]
    if cfg["host_user"]:
        overrides["EMAIL_HOST_USER"] = cfg["host_user"]
    if cfg["host_password"]:
        overrides["EMAIL_HOST_PASSWORD"] = cfg["host_password"]
    if cfg["use_tls"] is not None:
        overrides["EMAIL_USE_TLS"] = cfg["use_tls"]
    if cfg["use_ssl"] is not None:
        overrides["EMAIL_USE_SSL"] = cfg["use_ssl"]
    if cfg["from_email"]:
        overrides["EMAIL_FROM"] = cfg["from_email"]
        overrides["DEFAULT_FROM_EMAIL"] = cfg["from_email"]
    if cfg["reply_to"] is not None:
        overrides["EMAIL_REPLY_TO"] = cfg["reply_to"]
    return overrides


def _strip_control_chars(value: str) -> str:
    """Remove CR/LF/other control chars to defeat SMTP header injection."""
    return "".join(ch for ch in (value or "") if ch == "\t" or (ord(ch) >= 32 and ch != "\x7f"))


def send_email(subject, body, to_email, cc=[], reply_to=[]):
    """General function via which all emails are sent out."""
    subject = _strip_control_chars(subject)

    with override_settings(**_effective_email_settings()):
        from_email = settings.EMAIL_FROM
        reply_to_email = (
            [from_email] if settings.EMAIL_REPLY_TO is None else settings.EMAIL_REPLY_TO
        ) if reply_to == [] else reply_to
        # In DEBUG or to .local addresses, redirect to EMAIL_FROM so
        # emails don't escape to unintended recipients during dev.
        to_email = _strip_control_chars(to_email)
        to_email = [settings.EMAIL_FROM] if (
            settings.DEBUG or '.local' in to_email.lower()
        ) else [to_email]

        logger.info('Email server: %s', settings.EMAIL_HOST)
        connection = get_connection()
        mail = EmailMultiAlternatives(
            subject=subject, body="", from_email=from_email, to=to_email,
            cc=cc, reply_to=reply_to_email, connection=connection,
        )
        mail.attach_alternative(body, "text/html")
        mail.content_subtype = "html"

        mail.send()
        logger.info('Email "%s" sent to %s', subject, to_email)


def email_settings_context():
    """Return a ``contextlib`` context manager that applies the
    runtime-resolved email settings to ``settings``.

    Use this when you need both ``render_to_string`` and ``send_email``
    to see the DB-overridden SMTP settings - ``send_email`` applies the
    override internally but templates rendered before it won't.
    """
    return override_settings(**_effective_email_settings())
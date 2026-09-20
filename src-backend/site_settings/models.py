"""Singleton model holding the runtime-editable point factors, plus the
``resolve_*_settings`` helpers every integration uses to find its config.

All integrations (LLM/AI, Strava, Health, SMTP) read their configuration
from the environment ONLY - there is deliberately no DB override path, so
the ``.env`` values are always the ones in effect. The only setting that
stays editable at runtime is ``points_sport_factors`` (Admin page), which
has no environment representation.
"""

from django.conf import settings
from django.db import models


LLM_PROVIDER_DEFAULTS = {
    # OpenAI-compatible base URLs and sensible default models for the
    # providers we pre-configure via ``LLM_PROVIDER``. An explicit
    # ``LLM_BASE_URL`` / ``LLM_MODEL`` in the environment is used when no
    # preset matches.
    "MiniMax": {
        # Official OpenAI-compatible endpoint (platform.minimax.io docs).
        # Mainland-China accounts use https://api.minimaxi.com/v1 instead.
        "base_url": "https://api.minimax.io/v1",
        "model": "MiniMax-M3",
    },
}


class SiteSettings(models.Model):
    """There is exactly one row of this table - use :meth:`get_solo`.

    Only ``points_sport_factors`` remains runtime-editable; every other
    integration setting comes from the environment (see module docstring).
    """

    # ---- Points calculation ------------------------------------------
    # Per-activity-type multipliers on raw points, e.g. {"Swim": 1.5,
    # "Walk": 0.8}. Missing keys mean 1.0 (neutral). Edited by the admin
    # in Admin Settings; applied by competition.scorer._calculate_points_raw.
    points_sport_factors = models.JSONField(default=dict, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Site Settings"
        verbose_name_plural = "Site Settings"

    def __str__(self):
        return "Site Settings"

    def save(self, *args, **kwargs):
        """Force the table to hold exactly one row."""
        self.pk = 1
        # Diff the sport point factors before overwriting so changed
        # factors trigger a re-score of the affected points rows.
        try:
            old_factors = type(self).objects.get(pk=1).points_sport_factors or {}
        except type(self).DoesNotExist:
            old_factors = {}
        super().save(*args, **kwargs)
        new_factors = self.points_sport_factors or {}
        if old_factors != new_factors:
            from competition.scorer import apply_sport_factor_changes
            apply_sport_factor_changes(old_factors, new_factors)

    def delete(self, *args, **kwargs):
        # Refuse to delete the singleton; clear values instead so all
        # factors fall back to neutral (1.0).
        self.points_sport_factors = {}
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        """Return the single row, creating it if necessary."""
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


def resolve_llm_settings():
    """Active LLM configuration as a dict - straight from the environment.

    Resolution order:
      1. Provider preset (``LLM_PROVIDER=MiniMax`` auto-fills base URL + model)
      2. Explicit environment variables (``LLM_BASE_URL`` / ``LLM_MODEL``)
      3. Built-in defaults
    """
    provider = (settings.LLM_PROVIDER or "custom").strip() or "custom"
    preset = LLM_PROVIDER_DEFAULTS.get(provider, {})

    base_url = (preset.get("base_url") or (settings.LLM_BASE_URL or "").strip()) or None
    model = (preset.get("model") or (settings.LLM_MODEL or "").strip()) or "gpt-4o-mini"

    return {
        "provider": provider,
        "api_key": (settings.OPENAI_API_KEY or "").strip() or None,
        "base_url": base_url,
        "model": model,
        "email_model": (settings.LLM_EMAIL_MODEL or "gpt-4o").strip(),
    }


def resolve_strava_settings():
    """Active Strava configuration as a dict - straight from the environment."""
    return {
        "client_id": settings.STRAVA_CLIENT_ID,
        "client_secret": (settings.STRAVA_CLIENT_SECRET or "").strip() or None,
        "limit_15min": settings.STRAVA_LIMIT_15MIN,
        "limit_day": settings.STRAVA_LIMIT_DAY,
    }


def resolve_health_settings():
    """Active Open Wearables configuration as a dict - env only.

    Auth model: a developer JWT (from developer email + password) works
    on every OW endpoint - user management, data reads AND invitation
    codes - so one credential pair is all the connector needs. Missing
    password → the connector is disabled and the settings UI hides the
    link section.
    """
    base_url = (getattr(settings, "HEALTH_BASE_URL", "") or "").strip().rstrip("/")
    public_url = (getattr(settings, "HEALTH_PUBLIC_URL", "") or "").strip().rstrip("/")
    email = (getattr(settings, "HEALTH_DEVELOPER_EMAIL", "") or "").strip()
    password = (getattr(settings, "HEALTH_DEVELOPER_PASSWORD", "") or "").strip()
    return {
        "base_url": base_url or None,
        # The address phones use in the connection code. Default: the
        # app's own domain via the nginx /health/ route - the internal
        # base_url (docker hostname) is never reachable from a phone and
        # produced "host not found" in the app.
        "public_url": public_url or (settings.MAIN_HOST.rstrip("/") + "/health") or base_url or None,
        "developer_email": email or None,
        "developer_password": password or None,
        "enabled": bool(base_url and email and password),
    }


def resolve_email_settings():
    """Active SMTP configuration as a dict - straight from the environment."""
    return {
        "host": (settings.EMAIL_HOST or "").strip() or None,
        "port": settings.EMAIL_PORT,
        "host_user": (settings.EMAIL_HOST_USER or "").strip() or None,
        "host_password": (settings.EMAIL_HOST_PASSWORD or "").strip() or None,
        "use_tls": settings.EMAIL_USE_TLS,
        "use_ssl": settings.EMAIL_USE_SSL,
        "from_email": (settings.EMAIL_FROM or "").strip() or None,
        "reply_to": settings.EMAIL_REPLY_TO,
    }

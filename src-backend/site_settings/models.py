"""Singleton model holding runtime-editable site settings.

Resolution order is DB → environment variable, so admins can override
docker-compose defaults at runtime without restarting workers.
"""

from django.conf import settings
from django.db import models


def _truthy(value):
    if value is None:
        return None
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


LLM_PROVIDER_CHOICES = [
    ("custom", "Custom (OpenAI-compatible)"),
    ("MiniMax", "MiniMax"),
    ("openai", "OpenAI"),
]

LLM_PROVIDER_DEFAULTS = {
    # OpenAI-compatible base URLs and sensible default models for the
    # providers we pre-configure. Users can still override base_url /
    # model manually if they want a different model on the same provider.
    "MiniMax": {
        # Official OpenAI-compatible endpoint (platform.minimax.io docs).
        # Mainland-China accounts use https://api.minimaxi.com/v1 instead.
        "base_url": "https://api.minimax.io/v1",
        "model": "MiniMax-M3",
    },
}


class SiteSettings(models.Model):
    """There is exactly one row of this table - use :meth:`get_solo`."""

    # ---- LLM / AI provider configuration ------------------------------
    llm_provider = models.CharField(
        max_length=20,
        choices=LLM_PROVIDER_CHOICES,
        default="custom",
        blank=True,
        help_text="Preset provider. Picks sane defaults for base URL + model; you can override below.",
    )
    llm_api_key = models.CharField(max_length=200, blank=True, default="")
    llm_base_url = models.CharField(max_length=300, blank=True, default="")
    llm_model = models.CharField(max_length=80, blank=True, default="")
    llm_email_model = models.CharField(max_length=80, blank=True, default="")

    # ---- Strava OAuth + rate limits ------------------------------------
    strava_client_id = models.IntegerField(null=True, blank=True)
    strava_client_secret = models.CharField(max_length=200, blank=True, default="")
    strava_limit_15min = models.IntegerField(null=True, blank=True)
    strava_limit_day = models.IntegerField(null=True, blank=True)

    # ---- Health (Open Wearables: Apple Health / Health Connect) --------
    health_base_url = models.CharField(max_length=300, blank=True, default="")
    health_public_url = models.CharField(max_length=300, blank=True, default="")
    health_api_key = models.CharField(max_length=200, blank=True, default="")

    # ---- SMTP / outbound email -----------------------------------------
    email_host = models.CharField(max_length=200, blank=True, default="")
    email_port = models.IntegerField(null=True, blank=True)
    email_host_user = models.CharField(max_length=200, blank=True, default="")
    email_host_password = models.CharField(max_length=200, blank=True, default="")
    email_use_tls = models.BooleanField(null=True, blank=True)
    email_use_ssl = models.BooleanField(null=True, blank=True)
    email_from = models.CharField(max_length=200, blank=True, default="")
    email_reply_to = models.CharField(max_length=400, blank=True, default="",
                                      help_text="Comma-separated list of reply-to addresses.")

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Site Settings"
        verbose_name_plural = "Site Settings"

    def __str__(self):
        return "Site Settings"

    def save(self, *args, **kwargs):
        """Force the table to hold exactly one row."""
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        # Refuse to delete the singleton; clear values instead so the
        # site falls back to env vars.
        for f in self._meta.fields:
            if f.name in {"id", "updated_at"}:
                continue
            setattr(self, f.name, f.get_default())
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        """Return the single row, creating it if necessary."""
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def llm_api_key_masked(self):
        return _mask(self.llm_api_key)

    @property
    def strava_client_secret_masked(self):
        return _mask(self.strava_client_secret)

    @property
    def email_host_password_masked(self):
        return _mask(self.email_host_password)

    @property
    def health_api_key_masked(self):
        return _mask(self.health_api_key)


def _mask(value):
    value = value or ""
    if len(value) <= 6:
        return "*" * len(value)
    return f"{'*' * (len(value) - 4)}{value[-4:]}"


def _email_reply_to_list(value):
    """Parse a comma-separated string into a list of trimmed addresses."""
    if not value:
        return None
    parts = [p.strip() for p in value.split(",") if p.strip()]
    return parts or None


def resolve_llm_settings():
    """Active LLM configuration as a dict (DB → env → provider preset).

    Resolution order:
      1. DB column (``llm_base_url``, ``llm_model``) - explicit override
      2. Provider preset (e.g. MiniMax auto-fills base URL + model)
      3. Environment variable fallback
    """
    solo = SiteSettings.get_solo()

    provider = (solo.llm_provider or settings.LLM_PROVIDER or "custom").strip() or "custom"
    preset = LLM_PROVIDER_DEFAULTS.get(provider, {})

    db_base_url = (solo.llm_base_url or "").strip()
    preset_base_url = preset.get("base_url", "")
    env_base_url = (settings.LLM_BASE_URL or "").strip()

    db_model = (solo.llm_model or "").strip()
    preset_model = preset.get("model", "")
    env_model = (settings.LLM_MODEL or "").strip()

    base_url = db_base_url or preset_base_url or env_base_url or None
    model = db_model or preset_model or env_model or "gpt-4o-mini"

    return {
        "provider": provider,
        "api_key": (solo.llm_api_key or settings.OPENAI_API_KEY or "").strip() or None,
        "base_url": base_url,
        "model": model,
        "email_model": (solo.llm_email_model or settings.LLM_EMAIL_MODEL or "gpt-4o").strip(),
    }


def resolve_strava_settings():
    """Active Strava configuration as a dict (DB → env)."""
    solo = SiteSettings.get_solo()
    return {
        "client_id": solo.strava_client_id if solo.strava_client_id is not None else settings.STRAVA_CLIENT_ID,
        "client_secret": (solo.strava_client_secret or settings.STRAVA_CLIENT_SECRET or "").strip() or None,
        "limit_15min": solo.strava_limit_15min if solo.strava_limit_15min is not None else settings.STRAVA_LIMIT_15MIN,
        "limit_day": solo.strava_limit_day if solo.strava_limit_day is not None else settings.STRAVA_LIMIT_DAY,
    }


def resolve_health_settings():
    """Active Open Wearables configuration as a dict (DB → env).

    Both empty → the Health connector is disabled and the settings UI
    hides the link section.
    """
    solo = SiteSettings.get_solo()
    base_url = (solo.health_base_url or getattr(settings, "HEALTH_BASE_URL", "") or "").strip().rstrip("/")
    public_url = (solo.health_public_url or getattr(settings, "HEALTH_PUBLIC_URL", "") or "").strip().rstrip("/")
    api_key = (solo.health_api_key or getattr(settings, "HEALTH_API_KEY", "") or "").strip()
    return {
        "base_url": base_url or None,
        # The address phones use in the connection code - defaults to the
        # server-side base URL (fine when one address serves both).
        "public_url": public_url or base_url or None,
        "api_key": api_key or None,
        "enabled": bool(base_url and api_key),
    }


def resolve_email_settings():
    """Active SMTP configuration as a dict (DB → env)."""
    solo = SiteSettings.get_solo()
    db_reply_to = _email_reply_to_list(solo.email_reply_to)
    return {
        "host": (solo.email_host or settings.EMAIL_HOST or "").strip() or None,
        "port": solo.email_port if solo.email_port is not None else settings.EMAIL_PORT,
        "host_user": (solo.email_host_user or settings.EMAIL_HOST_USER or "").strip() or None,
        "host_password": (solo.email_host_password or settings.EMAIL_HOST_PASSWORD or "").strip() or None,
        "use_tls": solo.email_use_tls if solo.email_use_tls is not None else settings.EMAIL_USE_TLS,
        "use_ssl": solo.email_use_ssl if solo.email_use_ssl is not None else settings.EMAIL_USE_SSL,
        "from_email": (solo.email_from or settings.EMAIL_FROM or "").strip() or None,
        "reply_to": db_reply_to if db_reply_to is not None else settings.EMAIL_REPLY_TO,
    }
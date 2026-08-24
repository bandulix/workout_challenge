from rest_framework import serializers

from .models import SiteSettings


class SiteSettingsSerializer(serializers.ModelSerializer):
    """Site-wide configuration editable by admins.

    All secret fields (``llm_api_key``, ``strava_client_secret``,
    ``email_host_password``) are write-only - the API only ever returns
    a masked preview via the corresponding ``*_masked`` field.
    """

    llm_api_key_masked = serializers.CharField(read_only=True)
    strava_client_secret_masked = serializers.CharField(read_only=True)
    email_host_password_masked = serializers.CharField(read_only=True)
    health_developer_password_masked = serializers.CharField(read_only=True)

    class Meta:
        model = SiteSettings
        fields = [
            "id",
            # LLM
            "llm_provider",
            "llm_api_key",
            "llm_api_key_masked",
            "llm_base_url",
            "llm_model",
            "llm_email_model",
            # Strava
            "strava_client_id",
            "strava_client_secret",
            "strava_client_secret_masked",
            "strava_limit_15min",
            "strava_limit_day",
            # Health (Open Wearables)
            "health_base_url",
            "health_public_url",
            "health_developer_email",
            "health_developer_password",
            "health_developer_password_masked",
            # Points calculation
            "points_sport_factors",
            # Email
            "email_host",
            "email_port",
            "email_host_user",
            "email_host_password",
            "email_host_password_masked",
            "email_use_tls",
            "email_use_ssl",
            "email_from",
            "email_reply_to",
            # Meta
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]
        extra_kwargs = {
            "llm_api_key": {"write_only": True, "required": False, "allow_blank": True},
            "strava_client_secret": {"write_only": True, "required": False, "allow_blank": True},
            "email_host_password": {"write_only": True, "required": False, "allow_blank": True},
            "health_developer_password": {"write_only": True, "required": False, "allow_blank": True},
        }

    def validate_llm_base_url(self, value):
        value = (value or "").strip()
        if not value:
            return value
        from drill_instructor.llm_client import _safe_base_url
        if not _safe_base_url(value):
            raise serializers.ValidationError(
                "LLM base URL must be https to a public host (http is only allowed for localhost)."
            )
        return value

    def validate_health_base_url(self, value):
        return _validate_health_url(value)

    def validate_health_public_url(self, value):
        return _validate_health_url(value)


def _validate_health_url(value):
    """http(s) URL with a hostname; no embedded credentials.

    Unlike the LLM SSRF guard this MUST allow private/docker hosts -
    the backend talks to Open Wearables on the compose network
    (``http://openwearables:8000``) and phones may use a LAN address.
    """
    value = (value or "").strip()
    if not value:
        return value
    from urllib.parse import urlparse
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise serializers.ValidationError("Must be an http(s) URL with a hostname.")
    if parsed.username or parsed.password:
        raise serializers.ValidationError("URL must not include credentials.")
    return value.rstrip("/")
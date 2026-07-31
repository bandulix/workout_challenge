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
        }
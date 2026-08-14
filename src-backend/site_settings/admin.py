from django.contrib import admin

from .models import SiteSettings


@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):
    """Singleton admin.

    The standard ``add`` button is hidden; the single row is always
    edited in place. Blank secret fields preserve the stored value.
    """

    list_display = ("__str__", "updated_at")
    readonly_fields = ("llm_api_key_masked", "strava_client_secret_masked", "email_host_password_masked", "updated_at")
    fieldsets = (
        ("LLM / AI provider", {
            "fields": ("llm_provider", "llm_api_key", "llm_api_key_masked", "llm_base_url", "llm_model", "llm_email_model", "roast_image_prompt"),
            "description": "Used by the AI Drill Instructor and the weekly email AI fact. Pick a preset to auto-fill base URL + model; leave blank to fall back to environment variables. The roast image prompt template overrides the built-in photo-roast edit instruction (blank = default).",
        }),
        ("Strava", {
            "fields": ("strava_client_id", "strava_client_secret", "strava_client_secret_masked", "strava_limit_15min", "strava_limit_day"),
            "description": "Strava OAuth credentials and rate limits. Leave blank to fall back to environment variables.",
        }),
        ("SMTP / Outbound Email", {
            "fields": ("email_host", "email_port", "email_host_user", "email_host_password", "email_host_password_masked", "email_use_tls", "email_use_ssl", "email_from", "email_reply_to"),
            "description": "SMTP server configuration used for all automated emails. Leave blank to fall back to environment variables. Reply-To accepts a comma-separated list.",
        }),
        ("Meta", {
            "fields": ("updated_at",),
        }),
    )

    def has_add_permission(self, request):
        return not SiteSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
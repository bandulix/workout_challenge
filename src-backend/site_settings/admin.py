from django.contrib import admin

from .models import SiteSettings


@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):
    """Singleton admin.

    The standard ``add`` button is hidden; the single row is always
    edited in place. Only the point factors are stored here - all
    integration config (LLM/AI, Strava, Health, SMTP) is env-only.
    """

    list_display = ("__str__", "updated_at")
    readonly_fields = ("updated_at",)
    fieldsets = (
        ("Points calculation", {
            "fields": ("points_sport_factors",),
            "description": "Per-activity-type point multipliers, e.g. {\"Swim\": 1.5}. Missing keys are neutral (1.0).",
        }),
        ("Meta", {
            "fields": ("updated_at",),
        }),
    )

    def has_add_permission(self, request):
        return not SiteSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

from rest_framework import serializers

from .models import SiteSettings


class SiteSettingsSerializer(serializers.ModelSerializer):
    """The only site setting still editable at runtime: the per-activity-
    type point multipliers. Every integration config (LLM/AI keys and
    models, Strava, Health, SMTP) comes from the environment - the app
    intentionally offers no override UI or API for them.
    """

    class Meta:
        model = SiteSettings
        fields = [
            "id",
            "points_sport_factors",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]

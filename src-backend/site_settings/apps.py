from django.apps import AppConfig


class SiteSettingsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "site_settings"
    verbose_name = "Site Settings"

    def ready(self):
        # Create the singleton row on first boot so admin pages always
        # have something to edit. Safe to call on every startup.
        from .models import SiteSettings
        SiteSettings.get_solo()
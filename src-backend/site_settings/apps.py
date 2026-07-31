from django.apps import AppConfig


class SiteSettingsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "site_settings"
    verbose_name = "Site Settings"

    def ready(self):
        # Create the singleton row on first boot so admin pages always
        # have something to edit. Safe to call on every startup.
        #
        # This also runs during `manage.py migrate`, `collectstatic`,
        # `makemigrations` etc. - any of which can fire before the
        # site_settings table exists. Swallow the OperationalError so
        # those commands don't crash; the row will be created on the
        # next real startup.
        from django.db.utils import OperationalError, ProgrammingError

        from .models import SiteSettings
        try:
            SiteSettings.get_solo()
        except (OperationalError, ProgrammingError):
            pass
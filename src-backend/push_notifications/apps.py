from django.apps import AppConfig


class PushNotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "push_notifications"
    verbose_name = "Push Notifications"

    def ready(self):
        # Make sure the VAPID keypair exists (auto-generated on first run
        # and persisted under DATA_DIR/vapid.json so the same identity
        # survives container restarts).
        from .vapid import ensure_vapid_keys
        ensure_vapid_keys()
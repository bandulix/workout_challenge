from django.apps import AppConfig


class CustomUserConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'custom_user'

    def ready(self):
        from django.db.models.signals import pre_save
        try:
            from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        except Exception:
            return
        pre_save.connect(_hash_outstanding_token, sender=OutstandingToken)


def _hash_outstanding_token(sender, instance, **kwargs):
    """Store a digest, not the live refresh JWT, in OutstandingToken.token."""
    token = instance.token or ""
    if token and not str(token).startswith("sha256:"):
        import hashlib
        instance.token = "sha256:" + hashlib.sha256(str(token).encode()).hexdigest()

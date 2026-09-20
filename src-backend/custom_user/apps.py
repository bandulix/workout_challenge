import logging

from django.apps import AppConfig

logger = logging.getLogger(__name__)


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
        _warn_open_registration()


def _warn_open_registration():
    """Open registration crowns the FIRST registrant staff+superuser.
    Loud boot warning while that window is open (public deploys should
    set REGISTRATION_TOKEN or pre-create the superuser before exposing
    the app)."""
    from django.conf import settings
    if getattr(settings, "REGISTRATION_TOKEN", ""):
        return
    from django.db.utils import OperationalError, ProgrammingError
    try:
        from .models import CustomUser
        if CustomUser.objects.filter(is_superuser=True).exists():
            return
    except (OperationalError, ProgrammingError):
        return  # pre-migrate (collectstatic, makemigrations, ...)
    logger.warning(
        "REGISTRATION_TOKEN is empty and no superuser exists yet: the FIRST "
        "registered account becomes admin. On a publicly reachable server, set "
        "REGISTRATION_TOKEN or run createsuperuser before opening the app."
    )


def _hash_outstanding_token(sender, instance, **kwargs):
    """Store a digest, not the live refresh JWT, in OutstandingToken.token."""
    token = instance.token or ""
    if token and not str(token).startswith("sha256:"):
        import hashlib
        instance.token = "sha256:" + hashlib.sha256(str(token).encode()).hexdigest()

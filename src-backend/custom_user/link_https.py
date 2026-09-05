"""HTTPS enforcement for Garmin/Strava credential-link flows."""
from django.conf import settings
from rest_framework import status
from rest_framework.response import Response


def reject_insecure_link(request):
    """Reject Garmin/Strava linking over cleartext HTTP unless DEBUG.

    OAuth codes and Garmin credentials must not cross the wire in
    cleartext. Behind a reverse proxy, Django sees HTTPS via
    SECURE_PROXY_SSL_HEADER (X-Forwarded-Proto). Local development can
    set DEBUG=true to allow http://localhost.
    """
    if settings.DEBUG or request.is_secure():
        return None
    return Response(
        {
            "message": (
                "Linking requires HTTPS. Terminate TLS at a reverse proxy "
                "(and forward X-Forwarded-Proto) or set DEBUG=true for local development."
            )
        },
        status=status.HTTP_403_FORBIDDEN,
    )

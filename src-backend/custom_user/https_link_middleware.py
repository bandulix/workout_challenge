"""Reject Garmin/Strava credential-link requests over cleartext HTTP."""
from django.utils.deprecation import MiddlewareMixin
from custom_user.link_https import reject_insecure_link


# Paths that exchange OAuth codes / Garmin passwords (issue #17).
_LINK_PREFIXES = (
    "/api/strava/state/",
    "/api/strava/link/",
    "/api/garmin/link/",
)


class RequireHttpsForLinkMiddleware(MiddlewareMixin):
    """Block cleartext credential-link flows unless DEBUG.

    Runs early so the view never sees Garmin passwords or Strava codes
    on a non-TLS request. Behind a reverse proxy, Django sees HTTPS via
    SECURE_PROXY_SSL_HEADER / X-Forwarded-Proto.
    """

    def process_view(self, request, view_func, view_args, view_kwargs):
        path = request.path
        if not any(path.startswith(p) for p in _LINK_PREFIXES):
            return None
        blocked = reject_insecure_link(request)
        if blocked is None:
            return None
        # DRF Response -> Django HttpResponse
        from django.http import JsonResponse
        return JsonResponse(blocked.data, status=blocked.status_code)

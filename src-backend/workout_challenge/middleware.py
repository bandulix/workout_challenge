"""API responses must never be heuristically cached.

The Android app lives in a WebView whose disk cache survives app
restarts; without explicit cache headers it may serve stale API GETs
(heuristic freshness) - in the app that looked like "the server never
answers": the fresh request never hits the network (and never appears
in the nginx log). Browsers revalidate properly, which is why the bug
only showed in the APK.
"""

from django.http import HttpResponseNotFound


class BlockPublicMediaMiddleware:
    """Uploaded files must never be reachable by guessing /media/<name>.

    nginx already 404s /media/ and marks /protected-media/ internal.
    This is the Django-side belt: DEBUG runserver, a future
    ``static(MEDIA_URL)``, or a request that somehow bypasses nginx
    still cannot stream profile/photo/echo bytes.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ""
        if path.startswith("/media/") or path.startswith("/protected-media/"):
            return HttpResponseNotFound()
        return self.get_response(request)


class ApiNoStoreMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith("/api/") and not response.has_header("Cache-Control"):
            # no-store: never write to any cache (WebView disk cache
            # included); must-revalidate for good measure on older stacks.
            # Views with a deliberate policy (e.g. the authenticated
            # picture endpoints' "private, no-cache" = revalidate via
            # ETag) keep their own header.
            response["Cache-Control"] = "no-store, no-cache, must-revalidate"
            response["Pragma"] = "no-cache"
        return response

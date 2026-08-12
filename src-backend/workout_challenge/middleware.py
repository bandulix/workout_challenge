"""API responses must never be heuristically cached.

The Android app lives in a WebView whose disk cache survives app
restarts; without explicit cache headers it may serve stale API GETs
(heuristic freshness) - in the app that looked like "the server never
answers": the fresh request never hits the network (and never appears
in the nginx log). Browsers revalidate properly, which is why the bug
only showed in the APK.
"""


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

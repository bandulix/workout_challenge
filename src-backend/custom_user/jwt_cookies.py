"""httpOnly Secure refresh-token cookies (issue #19).

Access JWTs stay short-lived and are returned in the JSON body only
(frontend keeps them in memory). Refresh JWTs are delivered via an
httpOnly Secure cookie so browser JavaScript cannot read them.

Native Capacitor clients may also receive the refresh token in the JSON
body when the request looks native (User-Agent / X-WC-Client) so they
can persist it in EncryptedSharedPreferences / Capacitor Secure Storage
(cross-origin WebViews cannot always rely on the cookie jar alone).
"""

from django.conf import settings


REFRESH_COOKIE_NAME = getattr(settings, "JWT_REFRESH_COOKIE_NAME", "wc_refresh")
# Narrow path: cookie is only sent to token obtain/refresh/logout.
REFRESH_COOKIE_PATH = getattr(settings, "JWT_REFRESH_COOKIE_PATH", "/api/token")
CLIENT_HEADER = "HTTP_X_WC_CLIENT"
NATIVE_CLIENT = "native"


def refresh_cookie_kwargs():
    """Common Set-Cookie attributes for the refresh JWT."""
    secure = getattr(settings, "JWT_REFRESH_COOKIE_SECURE", not settings.DEBUG)
    # Lax is enough for same-origin PWA. Capacitor WebViews often call a
    # remote API cross-origin — None is required for those credentialed
    # fetches. Override via JWT_REFRESH_COOKIE_SAMESITE.
    default_samesite = "Lax" if settings.DEBUG else "None"
    samesite = getattr(settings, "JWT_REFRESH_COOKIE_SAMESITE", default_samesite)
    max_age = int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds())
    return {
        "key": REFRESH_COOKIE_NAME,
        "max_age": max_age,
        "httponly": True,
        "secure": secure,
        "samesite": samesite,
        "path": REFRESH_COOKIE_PATH,
    }


def set_refresh_cookie(response, refresh_token: str):
    kwargs = refresh_cookie_kwargs()
    response.set_cookie(value=refresh_token, **kwargs)
    return response


def clear_refresh_cookie(response):
    kwargs = refresh_cookie_kwargs()
    # Delete must match path/samesite/secure or browsers keep the cookie.
    response.delete_cookie(
        kwargs["key"],
        path=kwargs["path"],
        samesite=kwargs["samesite"],
    )
    return response


def get_refresh_from_request(request):
    """Prefer JSON/body refresh (native secure storage); else cookie."""
    data = getattr(request, "data", None) or {}
    if isinstance(data, dict):
        body_refresh = data.get("refresh")
        if body_refresh:
            return body_refresh
    return request.COOKIES.get(REFRESH_COOKIE_NAME) or None


def is_native_client(request) -> bool:
    if (request.META.get(CLIENT_HEADER) or "").strip().lower() == NATIVE_CLIENT:
        return True
    ua = (request.META.get("HTTP_USER_AGENT") or "").lower()
    return "workoutchallenge" in ua or "capacitor" in ua


def strip_refresh_from_response_data(response, request):
    """Omit refresh from JSON unless the Capacitor native client asked."""
    if is_native_client(request):
        return response
    data = getattr(response, "data", None)
    if isinstance(data, dict) and "refresh" in data:
        data = {k: v for k, v in data.items() if k != "refresh"}
        response.data = data
    return response

"""httpOnly Secure refresh-token cookies (issue #19).

Access JWTs stay short-lived and are returned in the JSON body only
(frontend keeps them in memory). Refresh JWTs are delivered via an
httpOnly Secure cookie so browser JavaScript cannot read them.

Native Capacitor clients may also receive the refresh token in the JSON
body when they send ``X-WC-Client: native`` so they can persist it in
EncryptedSharedPreferences / Capacitor Secure Storage (cross-origin
WebViews cannot always rely on the cookie jar alone).
"""

from django.conf import settings


REFRESH_COOKIE_NAME = getattr(settings, "JWT_REFRESH_COOKIE_NAME", "wc_refresh")
# Narrow path: cookie is only sent to token obtain/refresh/logout.
REFRESH_COOKIE_PATH = getattr(settings, "JWT_REFRESH_COOKIE_PATH", "/api/token")
CLIENT_HEADER = "HTTP_X_WC_CLIENT"
NATIVE_CLIENT = "native"
REQUESTED_WITH_HEADER = "HTTP_X_WC_REQUESTED_WITH"
REQUESTED_WITH_VALUE = "WorkoutChallenge"


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
    # Expire the cookie with the same flags it was set with. SameSite=None
    # deletions without Secure are ignored by browsers. Django's
    # delete_cookie() does not always accept ``secure=``.
    response.set_cookie(
        key=kwargs["key"],
        value="",
        max_age=0,
        expires="Thu, 01 Jan 1970 00:00:00 GMT",
        path=kwargs["path"],
        samesite=kwargs["samesite"],
        secure=kwargs["secure"],
        httponly=True,
    )
    return response


def get_refresh_from_request(request):
    """Prefer JSON/body refresh (native secure storage); else cookie.

    Returns ``(token, source)`` where source is ``"body"``, ``"cookie"``,
    or ``None``.
    """
    data = getattr(request, "data", None) or {}
    if isinstance(data, dict):
        body_refresh = data.get("refresh")
        if body_refresh:
            return body_refresh, "body"
    cookie = request.COOKIES.get(REFRESH_COOKIE_NAME) or None
    if cookie:
        return cookie, "cookie"
    return None, None


def is_native_client(request) -> bool:
    return (request.META.get(CLIENT_HEADER) or "").strip().lower() == NATIVE_CLIENT


def is_nonsimple_token_post(request) -> bool:
    """True when this is not a cross-site HTML form POST (CSRF)."""
    requested = (request.META.get(REQUESTED_WITH_HEADER) or "").strip()
    if requested == REQUESTED_WITH_VALUE:
        return True
    ctype = (
        getattr(request, "content_type", None)
        or request.META.get("CONTENT_TYPE")
        or ""
    ).split(";")[0].strip().lower()
    return ctype == "application/json"


def strip_refresh_from_response_data(response, request, source=None):
    """Omit refresh from JSON for browsers.

    Cookie-backed refresh must never echo the JWT, even if the client
    spoofs ``X-WC-Client: native``. Native login/rotation still receives
    JSON refresh when the token was presented in the body (or on obtain
    with the native header).
    """
    if source == "cookie":
        data = getattr(response, "data", None)
        if isinstance(data, dict) and "refresh" in data:
            response.data = {k: v for k, v in data.items() if k != "refresh"}
        return response
    if is_native_client(request):
        return response
    data = getattr(response, "data", None)
    if isinstance(data, dict) and "refresh" in data:
        response.data = {k: v for k, v in data.items() if k != "refresh"}
    return response

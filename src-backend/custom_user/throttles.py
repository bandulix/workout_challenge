"""Client-IP throttles that work behind this image's loopback nginx.

DRF's default ident is REMOTE_ADDR. Gunicorn binds 127.0.0.1, so every
public request would share one bucket and one client could lock login
for the whole site. Honour X-Real-IP / last X-Forwarded-For only when
the TCP peer is that loopback nginx.
"""

from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle

_TRUSTED_PROXIES = frozenset({"127.0.0.1", "::1", "localhost"})


def client_ip(request):
    remote = (getattr(request, "META", {}) or {}).get("REMOTE_ADDR") or ""
    remote = str(remote).strip() or "unknown"
    if remote not in _TRUSTED_PROXIES:
        return remote
    meta = request.META
    xreal = (meta.get("HTTP_X_REAL_IP") or "").strip()
    if xreal:
        return xreal.split(",")[0].strip() or remote
    xff = meta.get("HTTP_X_FORWARDED_FOR") or ""
    return xff.split(",")[-1].strip() or remote


class ClientIPScopedThrottle(ScopedRateThrottle):
    def get_ident(self, request):
        return client_ip(request)


class ClientIPAnonRateThrottle(AnonRateThrottle):
    def get_ident(self, request):
        return client_ip(request)

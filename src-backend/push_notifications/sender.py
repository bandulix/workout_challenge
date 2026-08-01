"""Web Push sender and per-user push helpers.

We deliberately keep this dependency-light: ``pywebpush`` handles the
cryptography and VAPID signing; everything else is plain ``logging``.
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable, Optional

from django.utils import timezone

from .models import PushSubscription
from .vapid import get_vapid_instance, get_vapid_public_key, get_vapid_subject

logger = logging.getLogger(__name__)

# Cap fan-out so a user with many devices doesn't stall the Celery worker.
_PUSH_POOL_SIZE = 8


def send_push_to_user(
    user,
    *,
    title: str,
    body: str,
    url: str = "/",
    icon: Optional[str] = None,
    badge: Optional[str] = None,
    tag: Optional[str] = None,
    # One hour: a dozing Android device must still get the ping when it
    # wakes. The previous 60s TTL meant FCM dropped most notifications
    # before delivery on battery-saving phones.
    ttl: int = 3600,
) -> int:
    """Send a push notification to every active subscription of ``user``.

    Returns the number of notifications successfully delivered.
    Sends in parallel via a small thread pool so multi-device users
    don't stall the Celery worker.
    """
    payload = json.dumps({"title": title, "body": body, "url": url, "icon": icon, "badge": badge, "tag": tag})
    subscriptions = list(user.push_subscriptions.all())
    if not subscriptions:
        return 0

    delivered = 0
    with ThreadPoolExecutor(max_workers=min(_PUSH_POOL_SIZE, len(subscriptions))) as pool:
        future_to_sub = {pool.submit(_send_one_safe, sub, payload, ttl): sub for sub in subscriptions}
        for fut in as_completed(future_to_sub):
            ok, error_kind, sub = fut.result()
            if ok:
                delivered += 1
            elif error_kind == "gone":
                sub.delete()
            elif error_kind == "permanent":
                logger.warning("Push to %s permanently failed", sub.id)
                sub.delete()
            # transient: log + keep subscription
    return delivered


# Human-readable hints per push-service status for the test-ping diagnostic.
# Raw exception text is intentionally NOT returned: provider error bodies
# can embed request details (CodeQL py/stack-trace-exposure). The full
# exception still lands in the server log.
_PUSH_ERROR_HINTS = {
    400: "push service rejected the request (VAPID/encryption)",
    401: "push service rejected the VAPID signature",
    403: "push service rejected the VAPID signature",
    404: "subscription no longer exists (removed)",
    410: "subscription expired or unsubscribed (removed)",
    413: "payload too large",
}


def send_push_to_user_detailed(
    user,
    *,
    title: str,
    body: str,
    url: str = "/",
    icon: Optional[str] = None,
    badge: Optional[str] = None,
    tag: Optional[str] = None,
    ttl: int = 3600,
) -> list:
    """Diagnostic variant of send_push_to_user: returns one outcome dict
    per subscription (ok / HTTP status / sanitised reason) so the test-ping
    button can show exactly where the push chain breaks - instead of the
    send failing silently into a log line nobody reads.
    """
    payload = json.dumps({"title": title, "body": body, "url": url, "icon": icon, "badge": badge, "tag": tag})
    results = []
    for sub in user.push_subscriptions.all():
        try:
            _send_one(sub, payload, ttl=ttl)
            results.append({"endpoint": sub.endpoint[:60], "ok": True})
        except Exception as exc:  # noqa: BLE001 - diagnostic: report everything
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            logger.warning("Test push to %s failed: %s", sub.id, exc)
            results.append({
                "endpoint": sub.endpoint[:60],
                "ok": False,
                "status": status_code,
                "error": f"{type(exc).__name__}: {_PUSH_ERROR_HINTS.get(status_code, 'network error reaching the push service')}",
            })
            if status_code in (404, 410):
                sub.delete()
    return results


def send_push_to_users(users: Iterable, *, title: str, body: str, url: str = "/") -> int:
    total = 0
    for u in users:
        total += send_push_to_user(u, title=title, body=body, url=url)
    return total


def has_any_subscription(user) -> bool:
    return user.push_subscriptions.exists()


def _send_one_safe(sub, payload, ttl):
    try:
        _send_one(sub, payload, ttl=ttl)
        return (True, None, sub)
    except _GoneError:
        return (False, "gone", sub)
    except _PermanentPushError:
        return (False, "permanent", sub)
    except Exception:  # noqa: BLE001 - transient
        logger.warning("Push to %s failed transiently", sub.id, exc_info=True)
        return (False, "transient", sub)


def _send_one(subscription: PushSubscription, payload: str, ttl: int = 60) -> None:
    from pywebpush import webpush, WebPushException

    info = {
        "endpoint": subscription.endpoint,
        "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
    }
    try:
        webpush(
            subscription_info=info,
            data=payload,
            vapid_private_key=get_vapid_instance(),
            vapid_claims={"sub": get_vapid_subject()},
            ttl=ttl,
        )
    except WebPushException as exc:
        status = getattr(exc, "response", None) and exc.response.status_code
        if status in (404, 410):
            raise _GoneError(str(exc))
        if status and 400 <= status < 500:
            raise _PermanentPushError(str(exc))
        raise


class _GoneError(Exception):
    pass


class _PermanentPushError(Exception):
    pass
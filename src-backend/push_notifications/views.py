import logging
import re

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import PushSubscription
from .serializers import PushSubscriptionSerializer
from .vapid import get_vapid_public_key

logger = logging.getLogger(__name__)


# Endpoint URLs come from the browser's PushSubscription JSON, but the
# Push API spec lets a misbehaving / malicious page post any string it
# wants. We restrict to the known push service origins so an attacker
# can't register the backend to a URL of their choosing (SSRF /
# stored-XSS-in-push-payload).
_ENDPOINT_RE = re.compile(r"^https://(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|wns\.windows\.com|notify\.windows\.com|push\.apple\.com|web\.push\.apple\.com|registry\.push\.services\.mozilla\.com|.+?\.push\.notifications\.apple\.com)/", re.IGNORECASE)


class PushSubscribeView(APIView):
    """Register the browser's ``PushSubscription`` for the current user.

    Idempotent per (user, endpoint): re-subscribing with the same endpoint
    updates the keys and ``last_seen_at``. Endpoints already owned by
    another user are rejected to prevent subscription hijacking.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PushSubscriptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        endpoint = serializer.validated_data["endpoint"]
        # Restrict the endpoint to known push services so the URL we
        # later send push notifications to (in sender.py) is never a
        # self-controlled or internal target.
        if not _ENDPOINT_RE.match(endpoint):
            return Response(
                {"endpoint": "Push endpoint must be HTTPS to a known push service."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        p256dh = serializer.validated_data["p256dh"]
        auth = serializer.validated_data["auth"]
        ua = serializer.validated_data.get("user_agent") or request.META.get("HTTP_USER_AGENT", "")[:300]

        existing_owner = PushSubscription.objects.filter(endpoint=endpoint).values_list("user_id", flat=True).first()
        if existing_owner is not None and existing_owner != request.user.id:
            return Response(
                {"detail": "This device is already registered to another user."},
                status=status.HTTP_409_CONFLICT,
            )

        sub, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={
                "user": request.user,
                "p256dh": p256dh,
                "auth": auth,
                "user_agent": ua,
            },
        )
        return Response(
            {
                "id": sub.id,
                "created": created,
                "vapid_public_key": get_vapid_public_key(),
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PushUnsubscribeView(APIView):
    """Remove a previously registered push subscription."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        endpoint = (request.data.get("endpoint") or "").strip()
        if not endpoint:
            return Response({"endpoint": "Required."}, status=status.HTTP_400_BAD_REQUEST)
        if not _ENDPOINT_RE.match(endpoint):
            return Response({"endpoint": "Invalid endpoint."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({"deleted": bool(deleted)}, status=status.HTTP_200_OK)


class PushStatusView(APIView):
    """Lightweight introspection: does this user have any push subscriptions?"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = request.user.push_subscriptions.all()
        # Single query: count + boolean in one hit.
        from django.db.models import Count
        annotated = qs.aggregate(total=Count("id"))
        return Response(
            {
                "subscribed": bool(annotated["total"]),
                "count": annotated["total"] or 0,
                "vapid_public_key": get_vapid_public_key(),
            }
        )
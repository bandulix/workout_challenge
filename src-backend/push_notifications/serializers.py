from rest_framework import serializers

from .models import PushSubscription


class PushSubscriptionSerializer(serializers.ModelSerializer):
    """Browser push subscription registration.

    The frontend posts the raw ``PushSubscription.toJSON()`` payload,
    normalised into the four fields we need.
    """

    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "p256dh", "auth", "user_agent", "created_at", "last_seen_at"]
        read_only_fields = ["id", "created_at", "last_seen_at"]
        extra_kwargs = {
            "endpoint": {"required": True},
            "p256dh": {"required": True},
            "auth": {"required": True},
        }

    def validate(self, attrs):
        if not attrs.get("endpoint") or not attrs.get("p256dh") or not attrs.get("auth"):
            raise serializers.ValidationError("endpoint, p256dh and auth are all required.")
        return attrs
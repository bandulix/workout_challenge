from django.db import models

from custom_user.models import CustomUser


class PushSubscription(models.Model):
    """A browser push subscription registered to a user.

    One user may have several subscriptions (one per device / browser).
    """

    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="push_subscriptions")

    endpoint = models.URLField(max_length=2000, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=64)

    user_agent = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-last_seen_at",)
        indexes = [models.Index(fields=["user"])]

    def __str__(self):
        return f"{self.user_id} → {self.endpoint[:60]}"
from django.contrib import admin

from .models import PushSubscription


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "endpoint", "user_agent", "created_at", "last_seen_at")
    list_filter = ("created_at",)
    search_fields = ("user__email", "user__username", "endpoint")
    readonly_fields = ("created_at", "last_seen_at")
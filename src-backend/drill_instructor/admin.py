from django.contrib import admin

from .models import (
    DailyOrder,
    DogTag,
    DrillInstructorConfig,
    DrillInstructorMessage,
    DrillInstructorPersona,
    EchoChallenge,
    LegendEcho,
)


@admin.register(DrillInstructorPersona)
class DrillInstructorPersonaAdmin(admin.ModelAdmin):
    list_display = ("name", "is_builtin", "created_by", "updated_at")
    list_filter = ("is_builtin",)
    search_fields = ("name", "description", "system_prompt")
    readonly_fields = ("created_at", "updated_at")


@admin.register(DrillInstructorConfig)
class DrillInstructorConfigAdmin(admin.ModelAdmin):
    list_display = ("competition", "enabled", "persona", "messages_posted", "last_posted_at")
    list_filter = ("enabled", "nudge_on_inactivity", "persona")
    search_fields = ("competition__name",)
    readonly_fields = ("last_posted_at", "messages_posted", "last_error", "created_at", "updated_at")


@admin.register(DrillInstructorMessage)
class DrillInstructorMessageAdmin(admin.ModelAdmin):
    list_display = ("posted_at", "config", "kind", "user", "parent", "success", "workout")
    list_filter = ("success", "kind", "config__competition")
    search_fields = ("body", "config__competition__name", "user__email")
    readonly_fields = tuple(f.name for f in DrillInstructorMessage._meta.fields)


@admin.register(DailyOrder)
class DailyOrderAdmin(admin.ModelAdmin):
    list_display = ("date", "config", "kind", "brief", "failed_announced")
    list_filter = ("kind", "failed_announced")
    search_fields = ("brief", "config__competition__name")


@admin.register(DogTag)
class DogTagAdmin(admin.ModelAdmin):
    list_display = ("user", "slug", "earned_at")
    list_filter = ("slug",)
    search_fields = ("user__email", "user__first_name")


@admin.register(LegendEcho)
class LegendEchoAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "power", "holder", "chain_length", "created_at")
    list_filter = ("status",)
    search_fields = ("title", "narrative", "holder__email", "origin_user__email")
    readonly_fields = ("created_at", "last_claimed_at", "immortalized_at")


@admin.register(EchoChallenge)
class EchoChallengeAdmin(admin.ModelAdmin):
    list_display = ("echo", "challenger", "status", "window_end", "committed_at")
    list_filter = ("status",)
    search_fields = ("echo__title", "challenger__email")

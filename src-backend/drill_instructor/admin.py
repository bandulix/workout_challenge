from django.contrib import admin

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona


@admin.register(DrillInstructorPersona)
class DrillInstructorPersonaAdmin(admin.ModelAdmin):
    list_display = ("name", "is_builtin", "created_by", "updated_at")
    list_filter = ("is_builtin",)
    search_fields = ("name", "description", "system_prompt")
    readonly_fields = ("created_at", "updated_at")

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.is_builtin:
            return False
        return super().has_delete_permission(request, obj)


@admin.register(DrillInstructorConfig)
class DrillInstructorConfigAdmin(admin.ModelAdmin):
    list_display = ("competition", "enabled", "persona", "messages_posted", "last_posted_at")
    list_filter = ("enabled", "persona")
    search_fields = ("competition__name", "matrix_room_id")
    readonly_fields = ("last_posted_at", "messages_posted", "last_error", "created_at", "updated_at", "access_token_masked")


@admin.register(DrillInstructorMessage)
class DrillInstructorMessageAdmin(admin.ModelAdmin):
    list_display = ("posted_at", "config", "success", "workout")
    list_filter = ("success", "config__competition")
    search_fields = ("body", "config__competition__name")
    readonly_fields = tuple(f.name for f in DrillInstructorMessage._meta.fields)

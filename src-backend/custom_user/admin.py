from django.contrib import admin

from .models import CustomUser, RecalcRequest

# Register your models here.
@admin.register(CustomUser)
class CustomUserAdmin(admin.ModelAdmin):
    """Admin view of CustomUser"""

    list_display = [
        "username",
        "first_name",
        "last_name",
    ]

@admin.register(RecalcRequest)
class RecalcRequestAdmin(admin.ModelAdmin):
    """Admin view of RecalcRequest"""

    list_display = [
        "user",
        "goal",
        "start_datetime",
        "done",
    ]
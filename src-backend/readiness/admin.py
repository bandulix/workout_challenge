from django.contrib import admin

from .models import (
    AthleteOrder,
    ChallengeReadinessSetting,
    MorningCheckIn,
    ReadinessSnapshot,
    RecoveryDay,
    RecoveryPreference,
)


@admin.register(RecoveryPreference)
class RecoveryPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "opted_in", "morning_push_enabled", "timezone")
    search_fields = ("user__email",)


@admin.register(RecoveryDay)
class RecoveryDayAdmin(admin.ModelAdmin):
    list_display = ("user", "date", "source", "sleep_minutes", "hrv_ms", "resting_hr")
    list_filter = ("source",)
    search_fields = ("user__email",)


@admin.register(MorningCheckIn)
class MorningCheckInAdmin(admin.ModelAdmin):
    list_display = ("user", "date", "feel", "soreness")


@admin.register(ReadinessSnapshot)
class ReadinessSnapshotAdmin(admin.ModelAdmin):
    list_display = ("user", "date", "score", "band", "warming_up")


@admin.register(AthleteOrder)
class AthleteOrderAdmin(admin.ModelAdmin):
    list_display = ("user", "date", "band", "kind", "completed")


@admin.register(ChallengeReadinessSetting)
class ChallengeReadinessSettingAdmin(admin.ModelAdmin):
    list_display = ("competition", "listen_bonus_enabled", "listen_bonus_points")

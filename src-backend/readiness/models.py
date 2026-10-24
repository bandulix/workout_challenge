from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from competition.models import Competition
from custom_user.models import CustomUser


class RecoveryPreference(models.Model):
    """Opt-in for recovery summaries, plus the athlete's morning clock.

    Device sync stays off until ``opted_in`` is set. Check-ins and the
    training-load fallback do not require it. Deleting recovery data
    clears the stored days and turns ``opted_in`` back off so the next
    sync does not immediately refill them.
    """

    user = models.OneToOneField(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="recovery_preference",
    )
    opted_in = models.BooleanField(default=False)
    consented_at = models.DateTimeField(null=True, blank=True)
    consent_version = models.CharField(max_length=8, blank=True, default="")
    scopes = models.JSONField(default=list, blank=True)
    # Blank uses Django's TIME_ZONE. Stored so sleep and the morning
    # push follow the athlete, not the server.
    timezone = models.CharField(max_length=64, blank=True, default="")
    morning_push_enabled = models.BooleanField(default=False)
    morning_push_minute = models.PositiveSmallIntegerField(null=True, blank=True)
    quiet_start_minute = models.PositiveSmallIntegerField(default=22 * 60)
    quiet_end_minute = models.PositiveSmallIntegerField(default=7 * 60)
    push_sent_on = models.DateField(null=True, blank=True)
    notice_acked_on = models.DateField(null=True, blank=True)
    backfill_done = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Recovery preference for user {self.user_id}"


class RecoveryDay(models.Model):
    """One local morning's recovery aggregates. Never a sample stream."""

    SOURCE_GARMIN = "garmin"
    SOURCE_HEALTH_CONNECT = "health_connect"
    SOURCE_APPLE = "apple_health"
    SOURCE_MIXED = "mixed"
    SOURCE_CHOICES = [
        (SOURCE_GARMIN, "Garmin"),
        (SOURCE_HEALTH_CONNECT, "Health Connect"),
        (SOURCE_APPLE, "Apple Health"),
        (SOURCE_MIXED, "Mixed"),
    ]

    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="recovery_days",
    )
    date = models.DateField()
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, blank=True, default="")
    sleep_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    sleep_quality = models.PositiveSmallIntegerField(null=True, blank=True)
    hrv_ms = models.FloatField(null=True, blank=True)
    hrv_metric = models.CharField(max_length=12, blank=True, default="")
    resting_hr = models.PositiveSmallIntegerField(null=True, blank=True)
    body_battery = models.PositiveSmallIntegerField(null=True, blank=True)
    training_readiness = models.PositiveSmallIntegerField(null=True, blank=True)
    stress_avg = models.PositiveSmallIntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "date"], name="one_recovery_day_per_user"),
        ]
        ordering = ["-date"]
        indexes = [
            models.Index(fields=["user", "date"], name="recovery_day_user_date"),
        ]

    def __str__(self):
        return f"{self.user_id} {self.date}"


class MorningCheckIn(models.Model):
    """Optional 1-tap morning check-in. Private to the athlete."""

    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="morning_checkins",
    )
    date = models.DateField()
    feel = models.PositiveSmallIntegerField()
    soreness = models.PositiveSmallIntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "date"], name="one_checkin_per_user_day"),
        ]

    def __str__(self):
        return f"{self.user_id} {self.date} feel {self.feel}"


class ReadinessSnapshot(models.Model):
    """The score the order was based on, for this athlete and this local date."""

    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="readiness_snapshots",
    )
    date = models.DateField()
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    band = models.CharField(max_length=8, blank=True, default="")
    why = models.CharField(max_length=180, blank=True, default="")
    components = models.JSONField(default=dict, blank=True)
    warming_up = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "date"], name="one_readiness_snapshot_per_day"),
        ]

    def __str__(self):
        return f"{self.user_id} {self.date} {self.band or 'warming'}"


class AthleteOrder(models.Model):
    """This athlete's order for one coached challenge-day.

    Private. It is not a feed post. The shared DailyOrder remains the
    fallback for athletes with no readiness band.
    """

    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="athlete_orders",
    )
    config = models.ForeignKey(
        "drill_instructor.DrillInstructorConfig",
        on_delete=models.CASCADE,
        related_name="athlete_orders",
    )
    date = models.DateField()
    kind = models.CharField(max_length=16)
    spec = models.JSONField(default=dict, blank=True)
    brief = models.CharField(max_length=280)
    voice = models.CharField(max_length=500, blank=True, default="")
    why = models.CharField(max_length=180, blank=True, default="")
    band = models.CharField(max_length=8, blank=True, default="")
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    notified = models.BooleanField(default=False)
    workout = models.ForeignKey(
        "workouts.Workout",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="athlete_orders",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "config", "date"], name="one_athlete_order_per_day"),
        ]
        indexes = [
            models.Index(fields=["user", "date"], name="athlete_order_user_date"),
        ]

    def __str__(self):
        return f"{self.user_id} {self.date} {self.band} {self.kind}"


class ChallengeReadinessSetting(models.Model):
    """Owner switch for a small 'listened to the coach' points bonus.

    Off by default. Recovery sessions already earn points under the
    normal rules; this bonus is extra and stays off unless the owner
    turns it on.
    """

    competition = models.OneToOneField(
        Competition,
        on_delete=models.CASCADE,
        related_name="readiness_setting",
    )
    listen_bonus_enabled = models.BooleanField(default=False)
    listen_bonus_points = models.PositiveSmallIntegerField(
        default=3,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        state = "on" if self.listen_bonus_enabled else "off"
        return f"Listen bonus {state} for competition {self.competition_id}"


def athlete_zone(user):
    """IANA zone for this athlete. Blank or unknown falls back to the site zone."""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    name = ""
    pref = getattr(user, "recovery_preference", None)
    if pref is None:
        pref = RecoveryPreference.objects.filter(user=user).first()
    if pref is not None:
        name = (pref.timezone or "").strip()
    name = name or getattr(settings, "TIME_ZONE", "UTC")
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(getattr(settings, "TIME_ZONE", "UTC"))


def athlete_today(user, now=None):
    now = now or timezone.now()
    return now.astimezone(athlete_zone(user)).date()

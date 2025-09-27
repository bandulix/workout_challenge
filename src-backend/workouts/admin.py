from django.contrib import admin

from .models import Workout
from competition.models import Points

# Register your models here.
class PointsInline(admin.TabularInline):
    """Table of Competition categories"""

    model = Points
    fk_name = "workout"
    can_delete = False
    extra = 0

@admin.register(Workout)
class WorkoutAdmin(admin.ModelAdmin):
    """Admin view of Workout"""

    list_display = [
        "user",
        "sport_type",
        "start_datetime",
        "strava_id",
    ]

    inlines = [
        PointsInline,
    ]
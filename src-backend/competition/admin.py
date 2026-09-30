from django.contrib import admin

from .models import Competition, ActivityGoal, Team, Award, ExpeditionCampaign
from .expedition import synchronize_expedition

# Register your models here.
class ActivityGoalInline(admin.TabularInline):
    """Table of Competition ActivityGoal"""

    model = ActivityGoal
    fk_name = "competition"
    can_delete = False
    extra = 0


class AwardsInline(admin.TabularInline):
    """Table of Awards"""

    model = Award
    fk_name = "competition"
    can_delete = False
    extra = 0


class TeamInline(admin.TabularInline):
    """Table of Competition teams"""

    model = Team
    fk_name = "competition"
    can_delete = False
    extra = 0



@admin.register(Competition)
class CompetitionAdmin(admin.ModelAdmin):
    """Admin view of Competition - the highest level e.g. Football World Cup 2024"""

    def has_delete_permission(self, request, obj=None):
        """Block admins form deleting a Tournament"""
        return False

    list_display = [
        "name",
        "start_date",
        "end_date",
    ]
    inlines = [
        ActivityGoalInline,
        AwardsInline,
        TeamInline,
    ]


@admin.register(ExpeditionCampaign)
class ExpeditionCampaignAdmin(admin.ModelAdmin):
    """Staff pilot toggle; route dates and identity remain system-owned."""

    list_display = ("competition", "enabled", "route_theme", "objective", "start_date", "end_date", "locked_at")
    list_filter = ("enabled",)
    fields = (
        "competition",
        "enabled",
        "route_theme",
        "objective",
        "route_template",
        "twist_plan",
        "twist_state",
        "start_date",
        "end_date",
        "locked_at",
    )
    readonly_fields = ("route_template", "start_date", "end_date", "locked_at", "twist_plan", "twist_state")

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        synchronized = synchronize_expedition(obj)
        obj.locked_at = synchronized.locked_at

    def has_delete_permission(self, request, obj=None):
        # Disable or hide a pilot through the flag; never delete its durable IDs.
        return False


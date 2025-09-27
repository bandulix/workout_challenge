from django.contrib import admin

from .models import Competition, ActivityGoal, Team, Award
from custom_user.models import CustomUser

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


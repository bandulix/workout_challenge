from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers
from custom_user.models import CustomUser
from .models import Competition, ActivityGoal, Team, Points
from .expedition_variants import OBJECTIVES, ROUTE_THEMES

EXPEDITION_OBJECTIVE_CHOICES = [(key, value["title"]) for key, value in OBJECTIVES.items()]
# "" = rotate automatically (least recently used by this organizer).
EXPEDITION_THEME_CHOICES = [("", "Surprise me")] + [(key, value["title"]) for key, value in ROUTE_THEMES.items()]


class CompetitionSerializer(serializers.ModelSerializer):
    owner = serializers.PrimaryKeyRelatedField(
        queryset=CustomUser.objects.all(),
        required=False
    )
    user_info = serializers.SerializerMethodField()
    goals = serializers.SerializerMethodField()
    my_rank_summary = serializers.SerializerMethodField()
    # Expedition settings, owner-editable from the challenge form. Stored on
    # the related ExpeditionCampaign; frozen once the route is locked.
    expedition_enabled = serializers.BooleanField(required=False)
    expedition_objective = serializers.ChoiceField(choices=EXPEDITION_OBJECTIVE_CHOICES, required=False)
    expedition_theme = serializers.ChoiceField(choices=EXPEDITION_THEME_CHOICES, required=False, allow_blank=True)
    expedition_locked = serializers.SerializerMethodField()
    # Ski week, owner-editable from the challenge form. Stored on the
    # related SkiWeekCampaign the same way Expedition is attached.
    skiweek_enabled = serializers.BooleanField(required=False)
    skiweek_resort_slug = serializers.CharField(required=False, allow_blank=True)
    skiweek_resort_query = serializers.CharField(required=False, allow_blank=True)
    skiweek_timezone = serializers.CharField(required=False, allow_blank=True)
    skiweek_cutoff_hour = serializers.IntegerField(required=False, min_value=0, max_value=23)
    skiweek_water_enabled = serializers.BooleanField(required=False)
    skiweek_points_per_sambuca = serializers.DecimalField(
        required=False, max_digits=6, decimal_places=2,
        min_value=Decimal("0"), max_value=Decimal("100"),
    )

    class Meta:
        model = Competition
        fields = ['id', 'owner', 'user', 'user_info', 'name', 'start_date', 'start_date_fmt', 'start_date_epoch', 'end_date', 'end_date_fmt', 'end_date_epoch', 'has_teams', 'organizer_assigns_teams', 'join_code', 'goals', 'my_rank_summary',
                  'expedition_enabled', 'expedition_objective', 'expedition_theme', 'expedition_locked',
                  'skiweek_enabled', 'skiweek_resort_slug', 'skiweek_resort_query', 'skiweek_timezone',
                  'skiweek_cutoff_hour', 'skiweek_water_enabled', 'skiweek_points_per_sambuca']
        read_only_fields = ['join_code', 'user', 'user_info', 'goals', 'my_rank_summary', 'expedition_locked']

    EXPEDITION_FIELDS = ("expedition_enabled", "expedition_objective", "expedition_theme")
    SKIWEEK_FIELDS = (
        "skiweek_enabled", "skiweek_resort_slug", "skiweek_resort_query", "skiweek_timezone",
        "skiweek_cutoff_hour", "skiweek_water_enabled", "skiweek_points_per_sambuca",
    )

    def get_expedition_locked(self, obj):
        campaign = getattr(obj, "expedition", None)
        return bool(campaign and campaign.locked_at)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        campaign = getattr(instance, "expedition", None)
        data["expedition_enabled"] = bool(campaign and campaign.enabled)
        data["expedition_objective"] = campaign.objective if campaign else "expedition"
        data["expedition_theme"] = campaign.route_theme if campaign else ""
        ski = getattr(instance, "skiweek", None)
        data["skiweek_enabled"] = bool(ski and ski.enabled)
        data["skiweek_resort_slug"] = ski.resort_slug if ski else ""
        data["skiweek_resort_query"] = ""
        data["skiweek_resort_name"] = ski.resort_name if ski else ""
        data["skiweek_timezone"] = ski.timezone if ski else "Europe/Zurich"
        data["skiweek_cutoff_hour"] = ski.day_cutoff_hour if ski else 5
        data["skiweek_water_enabled"] = bool(ski and ski.water_enabled)
        data["skiweek_points_per_sambuca"] = float(ski.points_per_sambuca) if ski else 5.0
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            data.pop("join_code", None)
        elif not (getattr(user, "is_staff", False) or user.pk == instance.owner_id):
            data.pop("join_code", None)
        return data

    def _pop_expedition(self, validated_data):
        return {key: validated_data.pop(key) for key in self.EXPEDITION_FIELDS if key in validated_data}

    def _apply_expedition(self, competition, settings):
        """Create or update the campaign row for the organizer's choice.

        Turning the Expedition off keeps the row (and any progress) but
        hides it; objective/theme are ignored once the route is locked -
        the model enforces that too, this just avoids a pointless write.
        """
        if not settings:
            return
        from .expedition import synchronize_expedition
        from .models import ExpeditionCampaign
        campaign = ExpeditionCampaign.objects.filter(competition=competition).first()
        wants_enabled = settings.get("expedition_enabled")
        if campaign is None:
            if not wants_enabled:
                return
            campaign = ExpeditionCampaign(competition=competition)
        if wants_enabled is not None:
            campaign.enabled = wants_enabled
        if not campaign.locked_at:
            if "expedition_objective" in settings:
                campaign.objective = settings["expedition_objective"]
            if "expedition_theme" in settings:
                campaign.route_theme = settings["expedition_theme"]
        campaign.save()
        if campaign.enabled:
            synchronize_expedition(campaign)

    def _pop_skiweek(self, validated_data):
        return {key: validated_data.pop(key) for key in self.SKIWEEK_FIELDS if key in validated_data}

    def _existing_skiweek(self):
        if self.instance is None:
            return None
        from .models import SkiWeekCampaign
        return SkiWeekCampaign.objects.filter(competition=self.instance).first()

    def validate(self, attrs):
        attrs = super().validate(attrs)
        touched = any(key in attrs for key in self.SKIWEEK_FIELDS)
        self._ski_resort = None
        if not touched:
            return attrs
        existing = self._existing_skiweek()
        enabled = attrs["skiweek_enabled"] if "skiweek_enabled" in attrs else bool(existing and existing.enabled)
        slug = attrs["skiweek_resort_slug"] if "skiweek_resort_slug" in attrs else (existing.resort_slug if existing else "")
        query = attrs.get("skiweek_resort_query") or ""
        timezone_name = attrs.get("skiweek_timezone") or ""
        if timezone_name:
            try:
                ZoneInfo(timezone_name)
            except ZoneInfoNotFoundError:
                raise serializers.ValidationError({"skiweek_timezone": "Unknown timezone."})
        needs_resort = enabled and not (existing and existing.latitude is not None and not slug and not query)
        if slug or query:
            from .resorts import ResortError, resolve_resort
            try:
                self._ski_resort = resolve_resort(slug=slug, query=query)
            except ResortError as exc:
                raise serializers.ValidationError({"skiweek_resort_slug": str(exc)})
        elif needs_resort and not (existing and existing.latitude is not None):
            raise serializers.ValidationError({"skiweek_resort_slug": "Pick an Alpine resort."})
        return attrs

    def _apply_skiweek(self, competition, settings):
        if not settings:
            return
        from .models import SkiWeekCampaign
        from custom_user.point_recalc import bump_stats_generation
        campaign = SkiWeekCampaign.objects.filter(competition=competition).first()
        wants = settings.get("skiweek_enabled")
        if campaign is None:
            if not wants:
                return
            campaign = SkiWeekCampaign(competition=competition)
        if wants is not None:
            campaign.enabled = wants
        resort = getattr(self, "_ski_resort", None)
        if resort:
            campaign.resort_slug = resort.get("slug") or ""
            campaign.resort_name = resort["name"]
            campaign.latitude = resort["latitude"]
            campaign.longitude = resort["longitude"]
            campaign.summit_elevation_m = resort.get("summit_elevation_m")
            campaign.valley_elevation_m = resort.get("valley_elevation_m")
            if not settings.get("skiweek_timezone") and resort.get("timezone"):
                campaign.timezone = resort["timezone"]
        if settings.get("skiweek_timezone"):
            campaign.timezone = settings["skiweek_timezone"]
        if "skiweek_cutoff_hour" in settings:
            campaign.day_cutoff_hour = settings["skiweek_cutoff_hour"]
        if "skiweek_water_enabled" in settings:
            campaign.water_enabled = settings["skiweek_water_enabled"]
        if "skiweek_points_per_sambuca" in settings:
            campaign.points_per_sambuca = settings["skiweek_points_per_sambuca"]
        if campaign.enabled and campaign.latitude is None:
            raise serializers.ValidationError({"skiweek_resort_slug": "Pick an Alpine resort."})
        campaign.save()
        bump_stats_generation([competition.pk])

    def create(self, validated_data):
        settings = self._pop_expedition(validated_data)
        ski = self._pop_skiweek(validated_data)
        competition = super().create(validated_data)
        self._apply_expedition(competition, settings)
        self._apply_skiweek(competition, ski)
        return competition

    def update(self, instance, validated_data):
        settings = self._pop_expedition(validated_data)
        ski = self._pop_skiweek(validated_data)
        competition = super().update(instance, validated_data)
        self._apply_expedition(competition, settings)
        self._apply_skiweek(competition, ski)
        # The reverse one-to-one may be cached from before the write (a
        # ReverseOneToOneDescriptor has no __delete__, so `del` cannot evict
        # it) - drop it from the fields cache so the response re-reads it.
        competition._state.fields_cache.pop("expedition", None)
        competition._state.fields_cache.pop("skiweek", None)
        return competition

    def validate_owner(self, owner):
        if self.instance is None:
            return owner
        if owner.pk == self.instance.owner_id:
            return owner
        if not self.instance.user.filter(pk=owner.pk).exists():
            raise serializers.ValidationError("New owner must be a participant.")
        return owner

    def get_user_info(self, obj):
        # Iterates the prefetch cache (viewsets prefetch `user`); a DB
        # order_by here would defeat it and N+1 every row - sort in
        # Python instead (identical output).
        users = sorted(obj.user.all(), key=lambda u: (u.username or "")) if hasattr(obj.user, 'all') else [obj.user]
        return [{'id': u.id, 'username': u.username} for u in users]

    def get_goals(self, obj):
        return ActivityGoalSerializer(obj.activitygoal_set.all(), many=True).data

    def get_my_rank_summary(self, obj):
        """Rank/team-rank chip for the dashboard row - same generation-
        keyed cache entry as the stats summary endpoint, so the list and
        the detail view share computations (and the dashboard needs no
        per-row poller)."""
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        pinned_rival_id = None
        if request:
            try:
                requested_challenge = int(request.query_params.get("home_rival_challenge", ""))
                requested_rival = int(request.query_params.get("home_rival_user", ""))
                if requested_challenge == obj.pk and requested_rival != user.id:
                    pinned_rival_id = requested_rival
            except (TypeError, ValueError):
                pass

        from django.core.cache import cache
        generation = cache.get(f"stats-generation:{obj.pk}", 0)
        rival_key = f":rival{pinned_rival_id}" if pinned_rival_id else ""
        cache_key = f"competition-summary:{obj.pk}:{user.id}:gen{generation}{rival_key}"
        payload = cache.get(cache_key)
        if payload is None:
            from .stats import get_competition_rank_summary
            payload = get_competition_rank_summary(
                obj.pk, user.id, pinned_rival_id=pinned_rival_id,
            )
            if payload is None:
                return None
            cache.set(cache_key, payload, 30)
        return payload


class TeamSerializer(serializers.ModelSerializer):
    user_info = serializers.SerializerMethodField()
    my = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = ['id', 'name', 'competition', 'user', 'user_info', 'my']
        read_only_fields = ['user', 'user_info', 'my']

    def get_user_info(self, obj):
        # Same prefetch-cache iteration as CompetitionSerializer.
        users = sorted(obj.user.all(), key=lambda u: (u.username or "")) if hasattr(obj.user, 'all') else [obj.user]
        return [{'id': u.id, 'username': u.username} for u in users]

    def get_my(self, obj):
        # if it is the user's team - membership test on the prefetched
        # list, not a filter() per row.
        request = self.context.get('request')
        if request and hasattr(request, "user"):
            return any(u.id == request.user.id for u in obj.user.all())
        return False

    def update(self, instance, validated_data):
        validated_data.pop("competition", None)
        return super().update(instance, validated_data)


class ActivityGoalSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityGoal
        fields = '__all__'

    def validate(self, attrs):
        # Model field validators (goal > 0) run automatically; the
        # min<=max pair check needs the merged row, so do it here.
        merged = {**{f: getattr(self.instance, f, None) for f in (
            "min_per_workout", "max_per_workout", "min_per_day", "max_per_day",
            "min_per_week", "max_per_week")}, **attrs} if self.instance else attrs
        for lo, hi in (
            ("min_per_workout", "max_per_workout"),
            ("min_per_day", "max_per_day"),
            ("min_per_week", "max_per_week"),
        ):
            lo_v = merged.get(lo)
            hi_v = merged.get(hi)
            if lo_v is not None and hi_v is not None and lo_v > hi_v:
                raise serializers.ValidationError({hi: "Must not be below the matching minimum."})
        return attrs

    def update(self, instance, validated_data):
        # Moving a goal onto another competition would let an owner
        # attach scoring rules to a challenge they don't run.
        validated_data.pop("competition", None)
        return super().update(instance, validated_data)


class PointsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Points
        fields = ['id', 'goal', 'award', 'workout', 'points_raw', 'points_capped']
        read_only_fields = []

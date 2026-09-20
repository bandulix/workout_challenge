from rest_framework import serializers
from custom_user.models import CustomUser
from .models import Competition, ActivityGoal, Team, Points


class CompetitionSerializer(serializers.ModelSerializer):
    owner = serializers.PrimaryKeyRelatedField(
        queryset=CustomUser.objects.all(),
        required=False
    )
    user_info = serializers.SerializerMethodField()
    goals = serializers.SerializerMethodField()
    my_rank_summary = serializers.SerializerMethodField()

    class Meta:
        model = Competition
        fields = ['id', 'owner', 'user', 'user_info', 'name', 'start_date', 'start_date_fmt', 'start_date_epoch', 'end_date', 'end_date_fmt', 'end_date_epoch', 'has_teams', 'organizer_assigns_teams', 'join_code', 'goals', 'my_rank_summary']
        read_only_fields = ['join_code', 'user', 'user_info', 'goals', 'my_rank_summary']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            data.pop("join_code", None)
        elif not (getattr(user, "is_staff", False) or user.pk == instance.owner_id):
            data.pop("join_code", None)
        return data

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
        from django.core.cache import cache
        generation = cache.get(f"stats-generation:{obj.pk}", 0)
        cache_key = f"competition-summary:{obj.pk}:{user.id}:gen{generation}"
        payload = cache.get(cache_key)
        if payload is None:
            from .stats import get_competition_rank_summary
            payload = get_competition_rank_summary(obj.pk, user.id)
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

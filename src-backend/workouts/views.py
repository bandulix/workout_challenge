import datetime

from django.db import models
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from custom_user.permissions import IsWorkoutOwner
from .models import Workout
from .serializers import WorkoutSerializer
from .filters import WorkoutFilter


class WorkoutViewSet(viewsets.ModelViewSet):
    serializer_class = WorkoutSerializer

    filter_backends = [DjangoFilterBackend]
    filterset_class = WorkoutFilter

    permission_classes = [IsWorkoutOwner]

    def get_queryset(self):
        # return all workouts from the user himself/herself
        #time.sleep(3)  # throttle for testing
        return Workout.objects.select_related('user').filter(user__id=self.request.user.id).order_by('-start_datetime', '-duration', '-id') # | Q(points__goal__competition__user=self.request.user)).distinct().order_by('-start_datetime', '-duration', '-id')

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        limit_raw = request.query_params.get("limit")
        offset_raw = request.query_params.get("offset")
        # Windowed listing for the dashboard history ("load more"). Without
        # params the full list is returned, as before.
        if limit_raw is not None or offset_raw is not None:
            try:
                offset = max(0, int(offset_raw or 0))
            except (TypeError, ValueError):
                offset = 0
            try:
                limit = max(1, min(int(limit_raw), 100)) if limit_raw is not None else 40
            except (TypeError, ValueError):
                limit = 40
            queryset = queryset[offset:offset + limit]
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Aggregate stats for the personal dashboard.

        The list endpoint caps at 100 rows, but the dashboard shows
        lifetime counts, 30-day aggregates, and the week streak -
        computing those client-side from the loaded page silently
        under-reported anyone with more workouts. Steps entries are
        excluded everywhere, matching the dashboard's own filters.
        """
        qs = self.get_queryset().exclude(sport_type="Steps")

        total_count = qs.count()
        by_sport_counts = {}
        for row in qs.values("sport_type").annotate(n=models.Count("id")).order_by("-n")[:4]:
            by_sport_counts[row["sport_type"]] = row["n"]

        today = timezone.localdate()
        day_30_ago = today - datetime.timedelta(days=29)
        day_7_ago = today - datetime.timedelta(days=6)

        def local_day(dt):
            return timezone.localtime(dt).date() if timezone.is_aware(dt) else dt.date()

        d30 = {"active_days": 0, "workouts": 0, "kcal": 0, "distance": 0.0, "seconds": 0}
        d7 = {"active_days": 0, "seconds": 0, "distance": 0.0}
        week_days = set()
        week_seconds = 0
        trained_weeks = set()
        days_30 = set()
        days_7 = set()

        # Per-day seconds for the dashboard heatmap (last 26 weeks).
        # Kept as a dict - untrained days are simply absent.
        HEATMAP_DAYS = 26 * 7
        heatmap_start = today - datetime.timedelta(days=HEATMAP_DAYS - 1)
        day_seconds = {}

        # The streak only needs trained Mondays; iterating timestamps
        # beats firing one EXISTS query per week of a long streak.
        for dt, duration, kcal, distance, _sport in qs.values_list(
                "start_datetime", "duration", "kcal", "distance", "sport_type"):
            day = local_day(dt)
            week_monday = day - datetime.timedelta(days=day.weekday())
            trained_weeks.add(week_monday)
            seconds = duration.total_seconds() if duration else 0
            if day >= heatmap_start and seconds:
                day_seconds[day.isoformat()] = day_seconds.get(day.isoformat(), 0) + int(seconds)
            if day >= day_30_ago:
                days_30.add(day)
                d30["workouts"] += 1
                d30["kcal"] += int(kcal or 0)
                d30["distance"] += float(distance or 0)
                d30["seconds"] += seconds
                if day >= day_7_ago:
                    days_7.add(day)
                    d7["seconds"] += seconds
                    d7["distance"] += float(distance or 0)
            if week_monday == today - datetime.timedelta(days=today.weekday()):
                week_days.add(day.weekday())
                week_seconds += seconds

        d30["active_days"] = len(days_30)
        d30["seconds"] = int(d30["seconds"])
        d30["distance"] = round(d30["distance"], 1)
        d7["active_days"] = len(days_7)
        d7["seconds"] = int(d7["seconds"])
        d7["distance"] = round(d7["distance"], 1)

        # Consecutive trained Monday-weeks ending this week; if this
        # week is still empty the streak survives on last week.
        streak = 0
        cursor = today - datetime.timedelta(days=today.weekday())
        if cursor not in trained_weeks:
            cursor -= datetime.timedelta(days=7)
        while cursor in trained_weeks:
            streak += 1
            cursor -= datetime.timedelta(days=7)

        return Response({
            "total_count": total_count,
            "by_sport": [[sport, n] for sport, n in by_sport_counts.items()],
            "d30": d30,
            "d7": d7,
            "week": {"seconds": int(week_seconds), "days": sorted(week_days)},
            "streak_weeks": streak,
            "days": day_seconds,
        })

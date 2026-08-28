from rest_framework import viewsets
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
        if limit_raw is not None:
            try:
                limit = max(1, min(int(limit_raw), 100))
            except (TypeError, ValueError):
                limit = 40
            queryset = queryset[:limit]
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

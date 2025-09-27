import time
from django.db.models import Q
from rest_framework import viewsets
from django_filters.rest_framework import DjangoFilterBackend

from custom_user.views import IsOwnerOrReadOnly
from .models import Workout
from competition.scorer import trigger_workout_change
from .serializers import WorkoutSerializer
from .filters import WorkoutFilter


class WorkoutViewSet(viewsets.ModelViewSet):
    #queryset = Competition.objects.all()
    serializer_class = WorkoutSerializer

    filter_backends = [DjangoFilterBackend]
    filterset_class = WorkoutFilter

    permission_classes = [IsOwnerOrReadOnly]

    def get_queryset(self):
        # return all workouts from the user himself/herself
        #time.sleep(3)  # throttle for testing
        return Workout.objects.select_related('user').filter(user__id=self.request.user.id).order_by('-start_datetime', '-duration', '-id') # | Q(points__goal__competition__user=self.request.user)).distinct().order_by('-start_datetime', '-duration', '-id')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

# filters.py
import django_filters
from .models import Workout

class WorkoutFilter(django_filters.FilterSet):
    my = django_filters.CharFilter(method='filter_my')

    def filter_my(self, queryset, name, value):
        # django-filter passes (self, queryset, field_name, value).
        # The previous body filtered Workout.pk == user.pk, which hid
        # every real workout. "my" means the authenticated athlete.
        return queryset.filter(user=self.request.user)

    class Meta:
        model = Workout
        fields = {}

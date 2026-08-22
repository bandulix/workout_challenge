# filters.py
import django_filters
from .models import CustomUser

class CustomUserFilter(django_filters.FilterSet):
    my = django_filters.CharFilter(method='filter_my')

    def filter_my(self, queryset, name, value):
        return queryset.filter(pk=self.request.user.pk)

    class Meta:
        model = CustomUser
        fields = {
            'username': ['exact', 'icontains'],
        }

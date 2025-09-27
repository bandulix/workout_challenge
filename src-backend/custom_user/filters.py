# filters.py
import django_filters
from .models import CustomUser

class CustomUserFilter(django_filters.FilterSet):
    my = django_filters.CharFilter(method='filter_my')

    def filter_my(request, queryset, *args, **kwargs):
        return queryset.filter(id=request.request.user.id)

    class Meta:
        model = CustomUser
        fields = {
            'username': ['exact', 'icontains'],
        }

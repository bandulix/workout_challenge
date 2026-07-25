from rest_framework import status
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SiteSettings
from .serializers import SiteSettingsSerializer


class SiteSettingsView(APIView):
    """GET/PUT the single SiteSettings row.

    Staff-only - the first registered user is auto-promoted to staff /
    superuser by ``custom_user.models.CustomUser.save``.
    """

    permission_classes = [IsAdminUser]

    def get(self, request):
        solo = SiteSettings.get_solo()
        return Response(SiteSettingsSerializer(solo).data)

    def put(self, request):
        solo = SiteSettings.get_solo()
        serializer = SiteSettingsSerializer(solo, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(SiteSettingsSerializer(solo).data, status=status.HTTP_200_OK)

    def patch(self, request):
        return self.put(request)
from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .release_notes import get_release_notes


class ReleaseVersionView(APIView):
    """Current release version + its changelog for the "What's new" popup.

    Public on purpose: the popup also works on the logged-out welcome /
    login pages, and neither the version nor the changelog is sensitive.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({
            "version": getattr(settings, "APP_VERSION", "dev"),
            "changelog": get_release_notes(),
        })

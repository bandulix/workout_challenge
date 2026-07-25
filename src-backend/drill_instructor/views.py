from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona
from .serializers import (
    DrillInstructorConfigSerializer,
    DrillInstructorMessageSerializer,
    DrillInstructorPersonaSerializer,
)


class DrillInstructorPersonaViewSet(viewsets.ModelViewSet):
    """Global CRUD on personas.

    Any authenticated user can list/retrieve. Any authenticated user can
    create / delete their own (non-builtin) personas. Builtin personas
    can only be edited by staff - regular users editing the system
    prompt of a built-in persona would be a prompt-injection vector.
    """

    serializer_class = DrillInstructorPersonaSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return DrillInstructorPersona.objects.all().order_by("name")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, is_builtin=False)

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.is_builtin and not (self.request.user.is_staff or self.request.user.is_superuser):
            raise PermissionDenied("Only staff can edit built-in personas.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.is_builtin:
            raise PermissionDenied("Built-in personas cannot be deleted.")
        instance.delete()


class DrillInstructorConfigViewSet(viewsets.ModelViewSet):
    """Per-competition Drill Instructor configuration.

    Reads: anyone who is owner of or participant in the competition.
    Writes: only the competition owner (same rule as ``IsOwnerOrReadOnly``
    for the parent competition).
    """

    serializer_class = DrillInstructorConfigSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return DrillInstructorConfig.objects.none()
        return (
            DrillInstructorConfig.objects
            .filter(Q(competition__owner=user) | Q(competition__user=user))
            .distinct()
            .select_related("competition", "persona")
            .order_by("competition__name")
        )

    def _ensure_owner(self, competition):
        if competition.owner_id != self.request.user.id and not self.request.user.is_staff:
            raise PermissionDenied("Only the competition owner can configure the Drill Instructor.")

    def perform_create(self, serializer):
        competition = serializer.validated_data.get("competition")
        self._ensure_owner(competition)
        if hasattr(competition, "drill_instructor"):
            raise PermissionDenied("Drill Instructor is already configured for this competition. Edit it instead.")
        serializer.save()

    def perform_update(self, serializer):
        self._ensure_owner(serializer.instance.competition)
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_owner(instance.competition)
        instance.delete()


class DrillInstructorMessageViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only history of Drill Instructor messages for debugging / UI."""

    serializer_class = DrillInstructorMessageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return DrillInstructorMessage.objects.none()
        return (
            DrillInstructorMessage.objects
            .filter(Q(config__competition__owner=user) | Q(config__competition__user=user))
            .distinct()
            .select_related("config", "config__competition", "workout")
        )


class DrillInstructorTestMessageView(APIView):
    """POST a one-off test message to the Matrix room of a competition.

    Only the competition owner can fire this. Runs the same Celery task
    the settings UI uses so failures surface in the same audit log.
    """

    MAX_BODY_LEN = 1000

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            config = DrillInstructorConfig.objects.select_related("competition").get(pk=pk)
        except DrillInstructorConfig.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if config.competition.owner_id != request.user.id and not request.user.is_staff:
            return Response({"detail": "Only the competition owner can send a test message."},
                            status=status.HTTP_403_FORBIDDEN)

        body = (request.data.get("body") or "").strip()
        if not body:
            return Response({"body": "Message body is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(body) > self.MAX_BODY_LEN:
            return Response(
                {"body": f"Message body too long (max {self.MAX_BODY_LEN} characters)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .tasks import post_test_message
        post_test_message.delay(config.id, body)
        return Response({"status": "queued"}, status=status.HTTP_202_ACCEPTED)

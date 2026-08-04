import datetime
import mimetypes

from django.conf import settings
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona
from .serializers import (
    DrillInstructorConfigSerializer,
    DrillInstructorMessageSerializer,
    DrillInstructorPersonaSerializer,
    DrillInstructorReplySerializer,
)


class DrillInstructorPersonaViewSet(viewsets.ModelViewSet):
    """Global CRUD on personas.

    Any authenticated user can list/retrieve (competition owners need the
    library to pick one). Writes are admin-only: a regular user editing
    the system prompt of a persona used by someone else's competition
    would be a prompt-injection vector.
    """

    serializer_class = DrillInstructorPersonaSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve", "picture"):
            return [IsAuthenticated()]
        return [IsAdminUser()]

    def get_queryset(self):
        return DrillInstructorPersona.objects.all().order_by("name")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, is_builtin=False)

    @action(detail=True, methods=["get"])
    def picture(self, request, pk=None):
        """Serve the persona's custom profile picture - authenticated only.

        Uploaded artwork must not be publicly reachable (copyright): it is
        never served from the public /media/ path. Django checks the JWT
        here and, in production, hands the actual file delivery to nginx
        via X-Accel-Redirect (an internal, non-public location). In bare
        Django dev (DEBUG) the file is streamed directly.
        """
        persona = self.get_object()
        if not persona.profile_picture:
            raise Http404("No custom profile picture.")

        content_type = (
            mimetypes.guess_type(persona.profile_picture.name)[0]
            or "application/octet-stream"
        )
        if settings.DEBUG:
            response = FileResponse(
                persona.profile_picture.open("rb"), content_type=content_type
            )
        else:
            response = HttpResponse(content_type=content_type)
            response["X-Accel-Redirect"] = f"/protected-media/{persona.profile_picture.name}"
        # The URL is stable per persona, so it must revalidate on every
        # use (ETag → cheap 304) - otherwise a changed picture would stay
        # stale in browser caches. Private: never stored by shared caches.
        response["Cache-Control"] = "private, no-cache"
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response


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
    """History of Drill Instructor messages for the Coach UI.

    Only thread roots are listed; replies (participants' and the coach's
    reactions) come nested inside their root message. Posting a reply is
    the single write action - every other message is written by the
    instructor's own tasks.
    """

    serializer_class = DrillInstructorMessageSerializer
    permission_classes = [IsAuthenticated]

    # Anti-spam / LLM-cost cap: each reply queues one coach reaction.
    MAX_REPLIES_PER_HOUR = 10
    MAX_REPLY_LEN = 500

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return DrillInstructorMessage.objects.none()
        qs = (
            DrillInstructorMessage.objects
            .filter(Q(config__competition__owner=user) | Q(config__competition__user=user))
            .filter(parent__isnull=True)
            .distinct()
            .select_related("config", "config__competition", "config__persona", "workout", "workout__user")
            .prefetch_related("replies", "replies__user")
        )
        competition = self.request.query_params.get("competition")
        if competition and competition.isdigit():
            qs = qs.filter(config__competition_id=int(competition))
        return qs

    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        """Post a participant's reply under a coach message.

        The message must be visible to the user (owner or participant of
        the competition), a thread root, and the coach must be on duty.
        The coach's reaction is generated asynchronously by the
        ``post_reply_reaction`` task, so the response is the created
        reply itself - the reaction arrives with the next feed poll.
        """
        root = self.get_object()  # 404 unless owner/participant; roots only
        config = root.config

        if not config.enabled:
            return Response({"body": "The coach is benched for this competition - it can't react right now."},
                            status=status.HTTP_400_BAD_REQUEST)

        body = (request.data.get("body") or "").strip()
        if not body:
            return Response({"body": "Reply text is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(body) > self.MAX_REPLY_LEN:
            return Response({"body": f"Reply too long (max {self.MAX_REPLY_LEN} characters)."},
                            status=status.HTTP_400_BAD_REQUEST)

        hour_ago = timezone.now() - datetime.timedelta(hours=1)
        recent = DrillInstructorMessage.objects.filter(
            kind=DrillInstructorMessage.KIND_REPLY, user=request.user, posted_at__gte=hour_ago,
        ).count()
        if recent >= self.MAX_REPLIES_PER_HOUR:
            return Response(
                {"body": f"Easy there - max {self.MAX_REPLIES_PER_HOUR} replies per hour. Give the coach a breather."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        reply = DrillInstructorMessage.objects.create(
            config=config,
            kind=DrillInstructorMessage.KIND_REPLY,
            parent=root,
            user=request.user,
            body=body,
        )

        from .tasks import post_reply_reaction
        post_reply_reaction.delay(reply.id)

        return Response(
            DrillInstructorReplySerializer(reply, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class DrillInstructorTestMessageView(APIView):
    """POST a one-off test message - runs the same Celery task the
    settings UI uses so the result shows up in the audit log.
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

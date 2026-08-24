import datetime
import mimetypes

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, ProtectedError, Q
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from workout_challenge.images import ProtectedMediaRenderer
from .llm_client import check_vision_capability
from competition.models import Points
from .models import (
    DrillInstructorConfig,
    DrillInstructorMessage,
    DrillInstructorPersona,
    DrillInstructorPersonaVote,
    DrillInstructorPhotoVote,
    EchoChallenge,
    LegendEcho,
)
from .serializers import (
    DrillInstructorConfigSerializer,
    DrillInstructorMessageSerializer,
    DrillInstructorPersonaSerializer,
    DrillInstructorReplySerializer,
    LegendEchoSerializer,
    RoastCardSerializer,
)


class DrillInstructorPersonaViewSet(viewsets.ModelViewSet):
    """Persona library.

    Staff can create, edit and delete every roaster (built-in or
    someone else's). Everyone else may only create/edit/delete the
    ones they made. List for regular users is built-ins plus theirs.
    """

    serializer_class = DrillInstructorPersonaSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = DrillInstructorPersona.objects.all()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        # List is the pickable library (built-ins + yours). Retrieve and
        # picture stay open so a custom coach's avatar still loads for
        # participants in that challenge. Writes are gated in perform_*.
        if self.action == "list" and not (user.is_staff or user.is_superuser):
            return qs.filter(Q(is_builtin=True) | Q(created_by=user)).order_by("name")
        return qs.order_by("name")

    def _may_write(self, persona):
        user = self.request.user
        if user.is_staff or user.is_superuser:
            return True
        if persona.is_builtin:
            return False
        return persona.created_by_id == user.id

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, is_builtin=False)

    def perform_update(self, serializer):
        if not self._may_write(serializer.instance):
            raise PermissionDenied("You can only edit a roaster you created.")
        serializer.save()

    def perform_destroy(self, instance):
        if not self._may_write(instance):
            raise PermissionDenied("You can only delete a roaster you created.")
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                {"detail": "This persona is still assigned to a challenge. Pick another coach there first."}
            )

    @action(detail=True, methods=["get"], renderer_classes=[ProtectedMediaRenderer])
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
        from workout_challenge.images import protected_media_response
        return protected_media_response(persona.profile_picture)


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
        today = timezone.localdate()
        from .models import DailyOrder
        return (
            DrillInstructorConfig.objects
            .filter(Q(competition__owner=user) | Q(competition__user=user))
            .distinct()
            .select_related("competition", "persona", "previous_persona", "dunce")
            .prefetch_related(Prefetch(
                "daily_orders",
                queryset=DailyOrder.objects.filter(date=today).prefetch_related("completed_by"),
                to_attr="todays_orders",
            ))
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

    @action(detail=True, methods=["get"])
    def ballot(self, request, pk=None):
        """Candidates, tallies, the caller's vote, and the handover countdown."""
        from .ballot import ballot_payload_for_request
        return Response(ballot_payload_for_request(self.get_object(), request))

    @action(detail=True, methods=["post"])
    def vote(self, request, pk=None):
        """Cast or change the caller's vote for next week's coach."""
        from .ballot import ballot_payload_for_request, eligible_personas

        config = self.get_object()
        if not config.enabled:
            raise ValidationError({"detail": "The coach is not on duty in this challenge yet."})
        today = timezone.localdate()
        if config.competition.end_date < today:
            raise ValidationError({"detail": "This challenge has finished."})
        try:
            persona_id = int(request.data.get("persona") or 0)
        except (TypeError, ValueError):
            persona_id = 0
        if not persona_id:
            raise ValidationError({"persona": "Pick a coach."})
        persona = get_object_or_404(DrillInstructorPersona, pk=persona_id)
        if not eligible_personas(config.competition, incumbent_id=config.persona_id).filter(pk=persona.pk).exists():
            raise ValidationError({"persona": "That coach is not on this challenge's ballot."})
        DrillInstructorPersonaVote.objects.update_or_create(
            config=config,
            user=request.user,
            defaults={"persona": persona},
        )
        return Response(ballot_payload_for_request(config, request))


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
    # Photos: a tight per-user daily cap (env-configurable) - every post
    # queues an LLM reaction (and possibly an image-edit roast), both of
    # which cost money, and a photo spam feed stops being fun quickly.
    MAX_PHOTOS_PER_DAY = settings.DRILL_MAX_PHOTOS_PER_DAY
    MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB
    MAX_PHOTO_CAPTION_LEN = 500

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return DrillInstructorMessage.objects.none()
        qs = (
            DrillInstructorMessage.objects
            .filter(Q(config__competition__owner=user) | Q(config__competition__user=user))
            .filter(parent__isnull=True)
            .distinct()
            .select_related("config", "config__competition", "config__persona", "persona", "workout", "workout__user")
            # Ordered prefetch the serializer actually iterates - a plain
            # prefetch_related was defeated by get_replies' own order_by,
            # costing one extra query per thread root.
            .prefetch_related(
                Prefetch(
                    "replies",
                    queryset=DrillInstructorMessage.objects.select_related("user").order_by("posted_at"),
                ),
                Prefetch(
                    "workout__points_set",
                    queryset=Points.objects.only("id", "workout_id", "points_capped", "points_raw"),
                ),
            )
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

    def _visible_thread_roots(self, user):
        return (
            DrillInstructorMessage.objects
            .filter(Q(config__competition__owner=user) | Q(config__competition__user=user))
            .filter(parent__isnull=True)
            .select_related("config", "config__competition", "workout")
            .distinct()
        )

    def _last_own_activity(self, user, competition_id):
        """The caller's most recent workout-comment thread in this challenge."""
        return (
            self._visible_thread_roots(user)
            .filter(
                config__competition_id=competition_id,
                kind=DrillInstructorMessage.KIND_ACTIVITY,
                workout__user=user,
            )
            .order_by("-posted_at")
            .first()
        )

    @action(detail=False, methods=["post"])
    def photo(self, request):
        """Attach a photo to the caller's latest own workout thread.

        The camera is available on every thread (including posts that
        @-mention the caller). The picture always hangs under their most
        recent activity comment in that challenge — never on someone
        else's workout and never as a standalone feed post. ``parent``
        (a visible thread root) or ``competition`` picks the challenge;
        the actual parent is resolved server-side.
        """
        no_workout = {
            "parent": "Photos hang under your latest workout. Log one and wait for the coach to comment first.",
        }
        user = request.user
        roots = self._visible_thread_roots(user)

        parent_id = request.data.get("parent")
        competition_id = request.data.get("competition")
        if parent_id not in (None, ""):
            try:
                parent_id = int(parent_id)
            except (TypeError, ValueError):
                return Response(no_workout, status=status.HTTP_400_BAD_REQUEST)
            hint = get_object_or_404(roots, pk=parent_id)
            competition_id = hint.config.competition_id
        elif competition_id not in (None, ""):
            try:
                competition_id = int(competition_id)
            except (TypeError, ValueError):
                return Response(no_workout, status=status.HTTP_400_BAD_REQUEST)
            get_object_or_404(
                DrillInstructorConfig.objects.filter(
                    Q(competition__owner=user) | Q(competition__user=user),
                    competition_id=competition_id,
                ).distinct()
            )
        else:
            return Response(no_workout, status=status.HTTP_400_BAD_REQUEST)

        parent = self._last_own_activity(user, competition_id)
        if parent is None:
            return Response(no_workout, status=status.HTTP_400_BAD_REQUEST)
        config = parent.config
        if not config.enabled:
            return Response({"competition": "The coach is benched for this competition - photo posts are paused."},
                            status=status.HTTP_400_BAD_REQUEST)

        # Photo posts only make sense when the coach can actually see
        # them: the feature is hidden in the UI and refused here when the
        # configured LLM rejects image input (probed + cached).
        if not check_vision_capability():
            return Response(
                {"image": "The configured AI model can't see pictures - photo posts are unavailable on this server."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        image = request.FILES.get("image")
        if image is None:
            return Response({"image": "A picture file is required."}, status=status.HTTP_400_BAD_REQUEST)
        from rest_framework.exceptions import ValidationError as DrfValidationError
        from workout_challenge.images import validate_and_reencode_image
        try:
            image = validate_and_reencode_image(image, max_bytes=self.MAX_PHOTO_BYTES, max_side=1600)
        except DrfValidationError as exc:
            detail = exc.detail
            message = detail[0] if isinstance(detail, list) else detail
            return Response({"image": str(message)}, status=status.HTTP_400_BAD_REQUEST)

        caption = (request.data.get("caption") or "").strip()
        if len(caption) > self.MAX_PHOTO_CAPTION_LEN:
            return Response({"caption": f"Caption too long (max {self.MAX_PHOTO_CAPTION_LEN} characters)."},
                            status=status.HTTP_400_BAD_REQUEST)

        day_ago = timezone.now() - datetime.timedelta(hours=24)
        recent = DrillInstructorMessage.objects.filter(
            kind=DrillInstructorMessage.KIND_PHOTO, user=request.user, posted_at__gte=day_ago,
        ).count()
        if recent >= self.MAX_PHOTOS_PER_DAY:
            return Response(
                {"image": f"That's enough pictures for today - max {self.MAX_PHOTOS_PER_DAY} per day."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        message = DrillInstructorMessage.objects.create(
            config=config,
            kind=DrillInstructorMessage.KIND_PHOTO,
            parent=parent,
            user=request.user,
            body=caption,
            image=image,
        )

        try:
            from .game import evaluate_photo_game
            evaluate_photo_game(message)
        except Exception:
            pass

        from .tasks import post_reply_reaction
        post_reply_reaction.delay(message.id)

        return Response(
            DrillInstructorMessageSerializer(message, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], renderer_classes=[ProtectedMediaRenderer])
    def picture(self, request, pk=None):
        """Serve a photo post's image - owner/participants only.

        Same privacy model as profile pictures: never on public /media/,
        Django checks membership (the member-scoped queryset 404s
        outsiders), production file delivery goes to nginx via
        X-Accel-Redirect; bare Django dev (DEBUG) streams the file.

        NOT the viewset's roots-only queryset: the coach's roast remix
        hangs on a child (reaction) message, so any message of a
        competition the user belongs to must resolve here.
        """
        message = get_object_or_404(
            DrillInstructorMessage.objects
            .filter(Q(config__competition__owner=request.user) | Q(config__competition__user=request.user))
            .distinct(),
            pk=pk,
        )
        if not message.image:
            raise Http404("No picture on this message.")
        from workout_challenge.images import protected_media_response
        return protected_media_response(message.image)

    # The swipe box shows the newest roasts across the user's
    # competitions; older cards fall off the edge (they stay in the
    # competition threads anyway).
    ROAST_BOX_LIMIT = 50

    @action(detail=False, methods=["get"])
    def roasts(self, request):
        """Roast cards for the Coach page's hot-or-not swipe box.

        Every coach reaction that carries an image (the remixed posters),
        newest first, scoped to the caller's competitions. Cards the
        caller has already rated are omitted - one vote per picture.
        """
        already_voted = DrillInstructorPhotoVote.objects.filter(
            user=request.user,
        ).values("message_id")
        qs = (
            DrillInstructorMessage.objects
            .filter(Q(config__competition__owner=request.user) | Q(config__competition__user=request.user))
            .filter(kind=DrillInstructorMessage.KIND_REACTION, user__isnull=True)
            .exclude(image="")
            .exclude(image__isnull=True)
            .exclude(pk__in=already_voted)
            .select_related("config", "config__competition", "config__persona", "persona", "parent", "parent__user")
            .prefetch_related(Prefetch(
                "photo_votes",
                queryset=DrillInstructorPhotoVote.objects.filter(user=request.user),
                to_attr="my_votes",
            ))
            .annotate(
                hot_votes=Count("photo_votes", filter=Q(photo_votes__hot=True), distinct=True),
                not_votes=Count("photo_votes", filter=Q(photo_votes__hot=False), distinct=True),
            )
            .distinct()
            .order_by("-posted_at")[: self.ROAST_BOX_LIMIT]
        )
        return Response(RoastCardSerializer(qs, many=True, context={"request": request}).data)

    HALL_SIZE = 50

    @action(detail=False, methods=["get"])
    def hall(self, request):
        """Hottest roasted photos the caller can see (Hall of Roasts).

        Optional ``competition`` limits the list to one challenge; omit it
        for every challenge the caller owns or is in (Coach page).
        """
        try:
            competition_id = int(request.query_params.get("competition") or 0)
        except (TypeError, ValueError):
            competition_id = 0
        qs = (
            DrillInstructorMessage.objects
            .filter(Q(config__competition__owner=request.user) | Q(config__competition__user=request.user))
            .filter(kind=DrillInstructorMessage.KIND_REACTION, user__isnull=True)
            .exclude(image="")
            .exclude(image__isnull=True)
        )
        if competition_id:
            qs = qs.filter(config__competition_id=competition_id)
        qs = (
            qs.select_related("config", "config__competition", "config__persona", "persona", "parent", "parent__user")
            .prefetch_related(Prefetch(
                "photo_votes",
                queryset=DrillInstructorPhotoVote.objects.filter(user=request.user),
                to_attr="my_votes",
            ))
            .annotate(
                hot_votes=Count("photo_votes", filter=Q(photo_votes__hot=True), distinct=True),
                not_votes=Count("photo_votes", filter=Q(photo_votes__hot=False), distinct=True),
            )
            .distinct()
            .order_by("-hot_votes", "-posted_at")[: self.HALL_SIZE]
        )
        return Response(RoastCardSerializer(qs, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def vote(self, request, pk=None):
        """Cast the caller's one hot-or-not vote on a roast card.

        A second vote on the same picture is refused (409) - the unique
        constraint is the source of truth; this is the API face of it.
        """
        # NOT the roots-only queryset: roasts are child messages - scope
        # by competition membership directly (same pattern as picture()).
        message = get_object_or_404(
            DrillInstructorMessage.objects
            .filter(Q(config__competition__owner=request.user) | Q(config__competition__user=request.user))
            .distinct(),
            pk=pk,
        )
        if not message.image or message.user_id is not None or message.kind != DrillInstructorMessage.KIND_REACTION:
            return Response({"message": "Only the coach's roasted photos can be voted on."},
                            status=status.HTTP_400_BAD_REQUEST)

        hot = request.data.get("hot")
        if not isinstance(hot, bool):
            return Response({"hot": "true or false required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                vote = DrillInstructorPhotoVote.objects.create(
                    message=message, user=request.user, hot=hot,
                )
        except IntegrityError:
            return Response(
                {"detail": "You already rated this picture."},
                status=status.HTTP_409_CONFLICT,
            )
        tally = message.photo_votes.aggregate(
            hot_votes=Count("id", filter=Q(hot=True)),
            not_votes=Count("id", filter=Q(hot=False)),
        )
        return Response({"id": message.id, "my_vote": vote.hot, **tally}, status=status.HTTP_200_OK)


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


class LegendEchoViewSet(viewsets.ReadOnlyModelViewSet):
    """The Echo Chamber: list living trophies, challenge one, read the Book."""

    serializer_class = LegendEchoSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        from .echoes import expire_challenges
        try:
            expire_challenges()
        except Exception:  # noqa: BLE001
            pass
        user = self.request.user
        qs = (
            LegendEcho.objects.filter(
                Q(config__competition__owner=user) | Q(config__competition__user=user)
            )
            .select_related(
                "origin_user", "holder", "config", "config__competition", "config__persona",
            )
            .prefetch_related(Prefetch(
                "challenges",
                queryset=EchoChallenge.objects.filter(status=EchoChallenge.STATUS_ACTIVE).select_related("challenger"),
                to_attr="active_challenges",
            ))
            .distinct()
            .order_by("-power", "-created_at")
        )
        try:
            competition_id = int(self.request.query_params.get("competition") or 0)
        except (TypeError, ValueError):
            competition_id = 0
        if competition_id:
            qs = qs.filter(config__competition_id=competition_id)
        return qs

    @action(detail=False, methods=["get"])
    def book(self, request):
        """End-of-season (or live) chronicle of every Echo in a challenge."""
        from competition.models import Competition
        from .echoes import book_payload
        try:
            competition_id = int(request.query_params.get("competition") or 0)
        except (TypeError, ValueError):
            competition_id = 0
        if not competition_id:
            return Response({"competition": "required."}, status=status.HTTP_400_BAD_REQUEST)
        competition = get_object_or_404(
            Competition.objects.filter(Q(owner=request.user) | Q(user=request.user)).distinct(),
            pk=competition_id,
        )
        return Response(book_payload(competition))

    @action(detail=True, methods=["post"])
    def challenge(self, request, pk=None):
        from .echoes import start_challenge
        echo = self.get_object()
        try:
            start_challenge(echo, request.user)
        except ValueError as exc:
            # Map to literals - never str(exc) (CodeQL py/stack-trace-exposure).
            reason = exc.args[0] if exc.args else ""
            if reason == "This Echo can no longer be challenged.":
                detail = "This Echo can no longer be challenged."
            elif reason == "This challenge is over.":
                detail = "This challenge is over."
            elif reason == "You already hold this Echo.":
                detail = "You already hold this Echo."
            elif reason == "Only challenge members can contest an Echo.":
                detail = "Only challenge members can contest an Echo."
            elif reason == "Someone is already coming for this Echo.":
                detail = "Someone is already coming for this Echo."
            elif reason == "Finish your current challenge first.":
                detail = "Finish your current challenge first."
            else:
                detail = "Could not start that challenge."
            raise ValidationError({"detail": detail})
        except IntegrityError:
            raise ValidationError({"detail": "Someone is already coming for this Echo."})
        echo = self.get_object()
        return Response(LegendEchoSerializer(echo, context={"request": request}).data)

    @action(detail=True, methods=["get"], renderer_classes=[ProtectedMediaRenderer])
    def picture(self, request, pk=None):
        echo = self.get_object()
        if not echo.image:
            raise Http404("No Echo art.")
        from workout_challenge.images import protected_media_response
        return protected_media_response(echo.image)

    MAX_ECHO_ART_BYTES = 5 * 1024 * 1024
    MAX_ECHO_ART_PER_DAY = 8

    @action(detail=True, methods=["post"])
    def art(self, request, pk=None):
        """Holder uploads a photo; we store it and remix it into Echo art.

        Only the current holder may set the picture (staff included only
        when they actually hold it). The raw upload is saved immediately
        so the crown placeholder disappears; a background edit then
        paints it to match the Echo title and sport. If no image-edit
        model is configured the original photo stays.
        """
        echo = self.get_object()
        user = request.user
        if echo.holder_id != user.id:
            return Response(
                {"detail": "Only the athlete who holds this Echo can set its picture."},
                status=status.HTTP_403_FORBIDDEN,
            )
        image = request.FILES.get("image")
        if image is None:
            return Response({"image": "A picture file is required."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core.cache import cache
        from rest_framework.exceptions import ValidationError as DrfValidationError
        from workout_challenge.images import validate_and_reencode_image

        try:
            image = validate_and_reencode_image(image, max_bytes=self.MAX_ECHO_ART_BYTES, max_side=1600)
        except DrfValidationError as exc:
            detail = exc.detail
            message = detail[0] if isinstance(detail, list) else detail
            return Response({"image": str(message)}, status=status.HTTP_400_BAD_REQUEST)

        day_key = f"echo-art-uploads:{user.id}:{timezone.now().date().isoformat()}"
        try:
            used = cache.incr(day_key)
        except ValueError:
            cache.add(day_key, 1, 86400)
            used = cache.get(day_key) or 1
        if used > self.MAX_ECHO_ART_PER_DAY:
            return Response(
                {"image": f"That's enough Echo art for today - max {self.MAX_ECHO_ART_PER_DAY} per day."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        echo.image.save(f"echo-{echo.pk}.jpg", image, save=True)
        from .tasks import remix_echo_art
        remix_echo_art.delay(echo.id, uploaded_by_id=user.id)
        echo.refresh_from_db()
        return Response(
            LegendEchoSerializer(echo, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


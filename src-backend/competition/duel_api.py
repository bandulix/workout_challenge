"""Duel API. Private details stay with the two athletes."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from competition.duels import (
    DuelError,
    create_duel,
    confirm_forfeit,
    mark_forfeit_paid,
    record_for,
    rematch,
    respond,
    serialize_duel,
    set_block,
)
from competition.models import Competition, Duel, DuelBlock, DuelPing


def _membership(user):
    return Competition.objects.filter(Q(owner=user) | Q(user=user)).distinct()


def _duel_for(user, duel_id):
    duel = (
        Duel.objects.select_related("competition", "challenger", "opponent", "competition__drill_instructor", "competition__drill_instructor__persona")
        .filter(Q(challenger=user) | Q(opponent=user))
        .filter(pk=duel_id)
        .first()
    )
    if duel is None:
        return None
    return duel


def _error(exc: DuelError):
    return Response({"detail": exc.message}, status=exc.status)


class DuelMineView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = (
            Duel.objects.select_related("competition", "challenger", "opponent")
            .filter(Q(challenger=request.user) | Q(opponent=request.user))
            .order_by("-created_at")
        )
        competition_id = request.query_params.get("competition")
        if competition_id:
            try:
                competition_id = int(competition_id)
            except (TypeError, ValueError):
                return Response({"detail": "Unknown challenge."}, status=404)
            if not _membership(request.user).filter(pk=competition_id).exists():
                return Response({"detail": "Join this challenge first."}, status=403)
            qs = qs.filter(competition_id=competition_id)
        open_count = Duel.objects.filter(
            Q(challenger=request.user) | Q(opponent=request.user),
            status__in=Duel.OPEN_STATUSES,
        ).count()
        return Response({
            "record": record_for(request.user.pk),
            "open_count": open_count,
            "blocked_user_ids": list(
                DuelBlock.objects.filter(blocker=request.user).values_list("blocked_id", flat=True)
            ),
            "results": [serialize_duel(duel, request.user) for duel in qs[:40]],
        })


class DuelCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, competition_id):
        competition = get_object_or_404(_membership(request.user), pk=competition_id)
        try:
            duel = create_duel(
                competition=competition,
                challenger=request.user,
                opponent_id=request.data.get("opponent_id"),
                duration_days=request.data.get("duration_days", 7),
                metric=request.data.get("metric") or Duel.METRIC_POINTS,
                sport_type=request.data.get("sport_type") or "",
                forfeit=request.data.get("forfeit") or "",
                forfeit_public=bool(request.data.get("forfeit_public")),
                feed_opt_in=bool(request.data.get("feed_opt_in")),
            )
        except DuelError as exc:
            return _error(exc)
        duel = Duel.objects.select_related("competition", "challenger", "opponent").get(pk=duel.pk)
        return Response(serialize_duel(duel, request.user, detailed=True), status=201)


class DuelDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, duel_id):
        duel = _duel_for(request.user, duel_id)
        if duel is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(serialize_duel(duel, request.user, detailed=True))


class DuelRespondView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, duel_id):
        duel = _duel_for(request.user, duel_id)
        if duel is None:
            return Response({"detail": "Not found."}, status=404)
        try:
            updated = respond(
                duel,
                request.user,
                action=request.data.get("action"),
                duration_days=request.data.get("duration_days"),
                forfeit=request.data.get("forfeit"),
                forfeit_public=request.data.get("forfeit_public"),
                feed_opt_in=request.data.get("feed_opt_in"),
            )
        except DuelError as exc:
            return _error(exc)
        updated = Duel.objects.select_related("competition", "challenger", "opponent").prefetch_related("notes").get(pk=updated.pk)
        return Response(serialize_duel(updated, request.user, detailed=True))


class DuelForfeitView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, duel_id):
        duel = _duel_for(request.user, duel_id)
        if duel is None:
            return Response({"detail": "Not found."}, status=404)
        action = (request.data.get("action") or "").strip().lower()
        try:
            if action == "mark_paid":
                updated = mark_forfeit_paid(duel, request.user)
            elif action == "confirm":
                updated = confirm_forfeit(duel, request.user)
            else:
                return Response({"detail": "Mark it paid or confirm it."}, status=400)
        except DuelError as exc:
            return _error(exc)
        updated = Duel.objects.select_related("competition", "challenger", "opponent").get(pk=updated.pk)
        return Response(serialize_duel(updated, request.user, detailed=True))


class DuelRematchView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, duel_id):
        duel = _duel_for(request.user, duel_id)
        if duel is None:
            return Response({"detail": "Not found."}, status=404)
        try:
            created = rematch(duel, request.user)
        except DuelError as exc:
            return _error(exc)
        created = Duel.objects.select_related("competition", "challenger", "opponent").get(pk=created.pk)
        return Response(serialize_duel(created, request.user, detailed=True), status=201)


class DuelBlockView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            set_block(request.user, request.data.get("user_id"), blocked=True)
        except DuelError as exc:
            return _error(exc)
        return Response({"blocked_user_ids": list(
            DuelBlock.objects.filter(blocker=request.user).values_list("blocked_id", flat=True)
        )})

    def delete(self, request):
        try:
            set_block(request.user, request.data.get("user_id"), blocked=False)
        except DuelError as exc:
            return _error(exc)
        return Response({"blocked_user_ids": list(
            DuelBlock.objects.filter(blocker=request.user).values_list("blocked_id", flat=True)
        )})


class DuelPingView(APIView):
    """Unseen private pings for the Android poll."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = DuelPing.objects.filter(user=request.user, seen_at__isnull=True).order_by("created_at")[:20]
        return Response({
            "results": [
                {"id": row.pk, "title": row.title, "body": row.body, "url": row.url}
                for row in rows
            ],
        })

    def post(self, request):
        raw = request.data.get("ids") or []
        if not isinstance(raw, list):
            return Response({"detail": "ids must be a list."}, status=400)
        ids = []
        for item in raw[:50]:
            try:
                ids.append(int(item))
            except (TypeError, ValueError):
                continue
        if ids:
            DuelPing.objects.filter(user=request.user, pk__in=ids, seen_at__isnull=True).update(seen_at=timezone.now())
        return Response({"seen": len(ids)})

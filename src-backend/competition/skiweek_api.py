"""Ski week HTTP API: resort list, home payload, Sambuca counter, snow."""

from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from workout_challenge.images import validate_and_reencode_image

from .models import Competition, SambucaEntry
from .resorts import public_resort_list
from .skiweek import (
    KIND_SAMBUCA,
    SkiWeekError,
    build_payload,
    log_sip,
    undo_last_sip,
    weather_for_campaign,
)


def _member_competition(request, competition_id):
    membership = Competition.objects.filter(
        Q(owner=request.user) | Q(user=request.user),
    ).distinct()
    return get_object_or_404(membership, pk=competition_id)


def _campaign_or_disabled(competition):
    campaign = getattr(competition, "skiweek", None)
    if campaign is None or not campaign.enabled:
        return None
    return campaign


def _error(exc: SkiWeekError):
    body = {"detail": str(exc), "code": exc.code, **exc.extra}
    return Response(body, status=exc.status)


class SkiWeekResortListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"resorts": public_resort_list()})


class SkiWeekView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, competition_id):
        competition = _member_competition(request, competition_id)
        campaign = _campaign_or_disabled(competition)
        if campaign is None:
            return Response({"enabled": False})
        return Response(build_payload(campaign, request.user))


class SkiWeekWeatherView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, competition_id):
        competition = _member_competition(request, competition_id)
        campaign = _campaign_or_disabled(competition)
        if campaign is None:
            return Response({"available": False, "enabled": False})
        payload = weather_for_campaign(campaign)
        payload["resort"] = campaign.resort_name
        return Response(payload)


class SkiWeekSipView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request, competition_id):
        competition = _member_competition(request, competition_id)
        campaign = _campaign_or_disabled(competition)
        if campaign is None:
            return Response({"detail": "This challenge has no ski week."}, status=404)
        photo = None
        if request.FILES.get("photo") is not None:
            try:
                photo = validate_and_reencode_image(request.FILES["photo"], field="photo")
            except Exception as exc:
                detail = getattr(exc, "detail", None) or "That photo could not be saved."
                return Response({"photo": detail}, status=400)
        try:
            amount = int(request.data.get("amount") or 1)
        except (TypeError, ValueError):
            return Response({"amount": "Amount must be 1, 2, or 3."}, status=400)
        confirm = str(request.data.get("confirm") or "").lower() in ("1", "true", "yes")
        try:
            entry = log_sip(
                campaign,
                request.user,
                amount=amount,
                kind=(request.data.get("kind") or KIND_SAMBUCA),
                confirm=confirm,
                photo=photo,
            )
        except SkiWeekError as exc:
            return _error(exc)
        return Response(build_payload(campaign, request.user), status=201)

    def delete(self, request, competition_id):
        competition = _member_competition(request, competition_id)
        campaign = _campaign_or_disabled(competition)
        if campaign is None:
            return Response({"detail": "This challenge has no ski week."}, status=404)
        kind = request.query_params.get("kind") or request.data.get("kind") or KIND_SAMBUCA
        try:
            undo_last_sip(campaign, request.user, kind=kind)
        except SkiWeekError as exc:
            return _error(exc)
        return Response(build_payload(campaign, request.user))


class SkiWeekSipPhotoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, competition_id, entry_id):
        competition = _member_competition(request, competition_id)
        entry = get_object_or_404(
            SambucaEntry.objects.filter(campaign__competition=competition, user=request.user),
            pk=entry_id,
        )
        if not entry.photo:
            raise Http404
        content_type = "image/jpeg"
        name = entry.photo.name.lower()
        if name.endswith(".png"):
            content_type = "image/png"
        elif name.endswith(".webp"):
            content_type = "image/webp"
        return FileResponse(entry.photo.open("rb"), content_type=content_type)

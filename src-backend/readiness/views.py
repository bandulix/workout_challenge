"""Readiness API. Every payload is the authenticated athlete's own data."""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from competition.models import Competition
from .models import ChallengeReadinessSetting, RecoveryPreference
from .service import (
    ack_notice,
    delete_recovery_data,
    save_checkin,
    setting_payload,
    today_payload,
)
from .sources import ALL_SCOPES, CONSENT_VERSION


class PreferenceSerializer(serializers.Serializer):
    opted_in = serializers.BooleanField(required=False)
    consent = serializers.BooleanField(required=False)
    scopes = serializers.ListField(child=serializers.CharField(), required=False)
    timezone = serializers.CharField(required=False, allow_blank=True, max_length=64)
    morning_push_enabled = serializers.BooleanField(required=False)
    morning_push_minute = serializers.IntegerField(required=False, min_value=0, max_value=1439, allow_null=True)
    quiet_start_minute = serializers.IntegerField(required=False, min_value=0, max_value=1439)
    quiet_end_minute = serializers.IntegerField(required=False, min_value=0, max_value=1439)

    def validate_scopes(self, value):
        unknown = [item for item in value if item not in ALL_SCOPES]
        if unknown:
            raise serializers.ValidationError("Unknown recovery scope.")
        # Preserve the documented order and drop duplicates.
        return [item for item in ALL_SCOPES if item in value]

    def validate_timezone(self, value):
        if not (value or "").strip():
            return ""
        try:
            ZoneInfo(value.strip())
        except ZoneInfoNotFoundError as exc:
            raise serializers.ValidationError("Unknown timezone.") from exc
        return value.strip()

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide at least one preference.")
        pref = self.context.get("preference")
        turning_on = attrs.get("opted_in") is True and not (pref and pref.opted_in)
        if turning_on and not attrs.get("consent"):
            raise serializers.ValidationError(
                {"consent": "Opting in needs an explicit consent confirmation."}
            )
        return attrs


class CheckInSerializer(serializers.Serializer):
    feel = serializers.IntegerField(min_value=1, max_value=5)
    soreness = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True)


class SettingSerializer(serializers.Serializer):
    listen_bonus_enabled = serializers.BooleanField(required=False)
    listen_bonus_points = serializers.IntegerField(required=False, min_value=0, max_value=10)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide a setting to change.")
        return attrs


class ReadinessTodayView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(today_payload(request.user, request.query_params.get("competition")))


class ReadinessPreferenceView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request):
        pref, _created = RecoveryPreference.objects.get_or_create(user=request.user)
        serializer = PreferenceSerializer(data=request.data, context={"preference": pref})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "opted_in" in data:
            pref.opted_in = data["opted_in"]
            if data["opted_in"]:
                from django.utils import timezone
                pref.consented_at = timezone.now()
                pref.consent_version = CONSENT_VERSION
            else:
                pref.scopes = []
        if "scopes" in data and pref.opted_in:
            pref.scopes = data["scopes"]
        if "timezone" in data:
            pref.timezone = data["timezone"]
        if "morning_push_enabled" in data:
            pref.morning_push_enabled = data["morning_push_enabled"]
        if "morning_push_minute" in data:
            pref.morning_push_minute = data["morning_push_minute"]
        if "quiet_start_minute" in data:
            pref.quiet_start_minute = data["quiet_start_minute"]
        if "quiet_end_minute" in data:
            pref.quiet_end_minute = data["quiet_end_minute"]
        pref.save()
        if pref.opted_in and pref.scopes:
            _queue_sync(request.user.pk)
        return Response(today_payload(request.user, request.query_params.get("competition")))


class ReadinessCheckInView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = CheckInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        save_checkin(request.user, serializer.validated_data["feel"], serializer.validated_data.get("soreness"))
        return Response(today_payload(request.user, request.query_params.get("competition")))


class ReadinessDataView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        delete_recovery_data(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReadinessNoticeAckView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ack_notice(request.user)
        return Response({"acked": True})


class ChallengeReadinessSettingView(APIView):
    """Owner-only. The bonus defaults off and never exposes another athlete's readiness."""

    permission_classes = [IsAuthenticated]

    def _competition(self, request, competition_id):
        competition = get_object_or_404(Competition, pk=competition_id)
        if not request.user.is_staff and competition.owner_id != request.user.id:
            return None
        return competition

    def get(self, request, competition_id):
        competition = self._competition(request, competition_id)
        if competition is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(setting_payload(competition))

    def patch(self, request, competition_id):
        competition = self._competition(request, competition_id)
        if competition is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        serializer = SettingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        setting, _created = ChallengeReadinessSetting.objects.get_or_create(competition=competition)
        data = serializer.validated_data
        if "listen_bonus_enabled" in data:
            setting.listen_bonus_enabled = data["listen_bonus_enabled"]
        if "listen_bonus_points" in data:
            setting.listen_bonus_points = data["listen_bonus_points"]
        setting.save()
        return Response(setting_payload(competition))


def _queue_sync(user_id):
    import logging

    log = logging.getLogger(__name__)
    try:
        from .tasks import sync_user_recovery
        sync_user_recovery.delay(user_id)
    except Exception as exc:  # noqa: BLE001
        log.info("Recovery sync was not queued for user %s: %s", user_id, exc)

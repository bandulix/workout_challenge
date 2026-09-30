import datetime

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from custom_user.models import CustomUser
from workouts.models import Workout
from .models import ComebackPreference, ComebackSupportOffer


class ComebackPreferencePatchSerializer(serializers.Serializer):
    prompts_enabled = serializers.BooleanField(required=False)
    support_opt_in = serializers.BooleanField(required=False)
    dismiss_for_days = serializers.IntegerField(required=False, min_value=1, max_value=30)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide at least one comeback preference.")
        return attrs


class ComebackBenchView(APIView):
    """Return and update only the authenticated user's private comeback bench."""

    permission_classes = [IsAuthenticated]

    @staticmethod
    def _payload(user):
        today = timezone.localdate()
        current_start = today - datetime.timedelta(days=6)
        previous_start = current_start - datetime.timedelta(days=7)
        activities = Workout.objects.filter(user=user).exclude(sport_type="Steps")
        previous_count = activities.filter(
            start_datetime__date__gte=previous_start,
            start_datetime__date__lt=current_start,
        ).count()
        current_count = activities.filter(
            start_datetime__date__gte=current_start,
            start_datetime__date__lt=today + datetime.timedelta(days=1),
        ).count()
        last_datetime = activities.order_by("-start_datetime").values_list("start_datetime", flat=True).first()
        last_date = timezone.localtime(last_datetime).date() if last_datetime else None
        preference, _ = ComebackPreference.objects.get_or_create(user=user)
        dismissed = preference.dismissed_until is not None and preference.dismissed_until >= today
        has_history = last_date is not None
        needs_bench = has_history and (
            current_count < previous_count
            or (today - last_date).days >= 7
        )
        prompt_visible = preference.prompts_enabled and not dismissed and needs_bench
        now = timezone.now()
        active_competitions = user.my_competitions.filter(
            start_date__lte=today, end_date__gte=today
        ).order_by("id")
        support_peers = []
        for competition in active_competitions:
            peers = CustomUser.objects.filter(
                my_competitions=competition,
                comeback_preference__support_opt_in=True,
            ).exclude(pk=user.pk).order_by("first_name", "id")
            support_peers.extend(
                {
                    "id": peer.id,
                    "first_name": peer.first_name or "Teammate",
                    "competition_id": competition.id,
                    "competition_name": competition.name,
                }
                for peer in peers
            )
        incoming_offers = ComebackSupportOffer.objects.filter(
            recipient=user,
            status=ComebackSupportOffer.STATUS_PENDING,
            created_at__gte=now - datetime.timedelta(days=14),
        ).select_related("sender", "competition")
        outgoing_offers = ComebackSupportOffer.objects.filter(
            sender=user,
            created_at__gte=now - datetime.timedelta(days=14),
        ).select_related("recipient", "competition")
        return {
            "current_period": {
                "start_date": current_start.isoformat(),
                "workout_count": current_count,
            },
            "previous_period": {
                "start_date": previous_start.isoformat(),
                "workout_count": previous_count,
            },
            "last_activity_date": last_date.isoformat() if last_date else None,
            "prompt_visible": prompt_visible,
            "return_action": (
                "If it feels right, log any comfortable activity. No catch-up or intensity target is needed; rest is valid too."
                if prompt_visible else None
            ),
            "preferences": {
                "prompts_enabled": preference.prompts_enabled,
                "dismissed_until": preference.dismissed_until.isoformat() if preference.dismissed_until else None,
                "support_opt_in": preference.support_opt_in,
            },
            "support_peers": support_peers,
            "incoming_offers": [
                {
                    "id": offer.id,
                    "sender_first_name": offer.sender.first_name or "Teammate",
                    "competition_name": offer.competition.name,
                    "offer_kind": offer.offer_kind,
                    "status": offer.status,
                }
                for offer in incoming_offers
            ],
            "outgoing_offers": [
                {
                    "id": offer.id,
                    "recipient_first_name": offer.recipient.first_name or "Teammate",
                    "competition_name": offer.competition.name,
                    "offer_kind": offer.offer_kind,
                    "status": offer.status,
                }
                for offer in outgoing_offers
            ],
        }

    def get(self, request):
        return Response(self._payload(request.user))

    def patch(self, request):
        serializer = ComebackPreferencePatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        preference, _ = ComebackPreference.objects.get_or_create(user=request.user)
        for field in ("prompts_enabled", "support_opt_in"):
            if field in serializer.validated_data:
                setattr(preference, field, serializer.validated_data[field])
        dismiss_for_days = serializer.validated_data.get("dismiss_for_days")
        if dismiss_for_days is not None:
            preference.dismissed_until = timezone.localdate() + datetime.timedelta(days=dismiss_for_days - 1)
        preference.save()
        return Response(self._payload(request.user), status=status.HTTP_200_OK)


class ComebackSupportOfferCreateSerializer(serializers.Serializer):
    recipient_id = serializers.IntegerField(min_value=1)
    competition_id = serializers.IntegerField(min_value=1)
    offer_kind = serializers.ChoiceField(choices=ComebackSupportOffer.OFFER_KINDS)


class ComebackSupportOfferCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ComebackSupportOfferCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        recipient_id = serializer.validated_data["recipient_id"]
        competition_id = serializer.validated_data["competition_id"]
        today = timezone.localdate()
        competition = get_object_or_404(
            request.user.my_competitions.filter(
                pk=competition_id,
                start_date__lte=today,
                end_date__gte=today,
            )
        )
        recipient = get_object_or_404(
            CustomUser.objects.filter(pk=recipient_id, my_competitions=competition)
        )
        if recipient.pk == request.user.pk:
            return Response({"detail": "You cannot offer support to yourself."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            preference = ComebackPreference.objects.select_for_update().filter(user=recipient).first()
            if preference is None or not preference.support_opt_in:
                return Response(
                    {"detail": "This teammate is not accepting support offers."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            recent_offer = ComebackSupportOffer.objects.filter(
                sender=request.user,
                recipient=recipient,
                competition=competition,
                created_at__gte=timezone.now() - datetime.timedelta(days=7),
            ).exists()
            if recent_offer:
                return Response(
                    {"detail": "Please wait before offering support again."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            offer = ComebackSupportOffer.objects.create(
                sender=request.user,
                recipient=recipient,
                competition=competition,
                offer_kind=serializer.validated_data["offer_kind"],
            )
        return Response(
            {"id": offer.id, "status": offer.status},
            status=status.HTTP_201_CREATED,
        )


class ComebackSupportOfferRespondSerializer(serializers.Serializer):
    accepted = serializers.BooleanField()


class ComebackSupportOfferRespondView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, offer_id):
        serializer = ComebackSupportOfferRespondSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        offer = get_object_or_404(
            ComebackSupportOffer.objects.filter(
                pk=offer_id,
                recipient=request.user,
                status=ComebackSupportOffer.STATUS_PENDING,
                created_at__gte=timezone.now() - datetime.timedelta(days=14),
            )
        )
        offer.status = (
            ComebackSupportOffer.STATUS_ACCEPTED
            if serializer.validated_data["accepted"]
            else ComebackSupportOffer.STATUS_DECLINED
        )
        offer.responded_at = timezone.now()
        offer.save(update_fields=["status", "responded_at"])
        return Response({"id": offer.id, "status": offer.status}, status=status.HTTP_200_OK)

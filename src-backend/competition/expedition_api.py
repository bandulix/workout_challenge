"""Read-only API for enabled, participant-visible Expeditions."""

from decimal import Decimal

from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .expedition import (
    _score_periods,
    active_twist,
    current_expedition_coach,
    expedition_crew_summary,
    read_expedition_progress,
    recompute_expedition_progress,
    settle_shortcut,
    synchronize_expedition,
)
from .expedition_variants import (
    OBJECTIVE_TREASURE,
    SHORTCUT_CHOICES,
    TWIST_SHORTCUT,
    objective,
    route_theme,
)
from .models import Competition, ExpeditionCampaign


def _milestone_status(milestone, progress_percent, today, end_date):
    if milestone.completed_at:
        return "completed"
    if today < milestone.opens_on:
        return "upcoming"
    if (
        milestone.milestone_id == "finale"
        and progress_percent >= Decimal("100")
        and today < end_date
    ):
        return "ready"
    if today > milestone.target_on:
        return "behind"
    return "in-progress"


class ExpeditionView(APIView):
    """Expose a pilot route only to enrolled participants."""

    permission_classes = [IsAuthenticated]

    def get(self, request, competition_id):
        membership = Competition.objects.filter(
            Q(owner=request.user) | Q(user=request.user),
        ).distinct()
        competition = get_object_or_404(membership, pk=competition_id)
        campaign = get_object_or_404(
            ExpeditionCampaign.objects.select_related("competition").filter(
                competition=competition,
                enabled=True,
            ),
        )

        today = timezone.localdate()
        try:
            campaign = synchronize_expedition(campaign, today=today)
            stats_generation = cache.get(
                f"stats-generation:{competition.pk}",
                0,
            )
            refresh_key = (
                f"expedition-refresh:{campaign.pk}:{today.isoformat()}:"
                f"{campaign.updated_at.timestamp()}:{stats_generation}"
            )
            if cache.add(refresh_key, True, timeout=15):
                progress = recompute_expedition_progress(
                    campaign,
                    user_id=request.user.pk,
                    today=today,
                )
            else:
                progress = read_expedition_progress(
                    campaign,
                    user_id=request.user.pk,
                    today=today,
                )
        except ValueError as error:
            return Response({"detail": str(error)}, status=400)

        campaign.refresh_from_db()
        finale_snapshot = campaign.finale_snapshot
        personal_progress_by_participant = finale_snapshot.get("personal_progress_by_participant", {})
        finale = {
            "final_date": campaign.end_date.isoformat(),
            "status": "final" if finale_snapshot else "live" if today >= campaign.end_date else "scheduled",
            "group_progress_percent": float(
                finale_snapshot.get("progress_percent", progress["progress_percent"])
            ),
            "personal_progress_percent": float(
                personal_progress_by_participant.get(
                    str(request.user.pk),
                    finale_snapshot.get("personal_progress_percent", progress["personal_progress_percent"]),
                )
            ),
            "participant_count": finale_snapshot.get("participant_count", progress["participant_count"]),
            "coach_snapshot": finale_snapshot.get("coach"),
        }
        current_coach = current_expedition_coach(competition)
        milestone_rows = list(campaign.milestones.order_by("sequence"))
        previous_completed_coach = next(
            (item.coach_snapshot for item in reversed(milestone_rows)
             if item.completed_at and item.coach_snapshot),
            None,
        )
        next_milestone = next(
            (item for item in milestone_rows if not item.completed_at),
            None,
        )
        coach_handover = None
        if previous_completed_coach and next_milestone:
            previous_key = previous_completed_coach.get("key") or previous_completed_coach.get("id")
            current_key = current_coach.get("key") or current_coach.get("id")
            if previous_key != current_key:
                coach_handover = {
                    "from": previous_completed_coach,
                    "to": current_coach,
                    "milestone_id": next_milestone.milestone_id,
                }
        milestones = [
            {
                "stage_id": item.stage_id,
                "milestone_id": item.milestone_id,
                "sequence": item.sequence,
                "opens_on": item.opens_on.isoformat(),
                "target_on": item.target_on.isoformat(),
                "progress_fraction": float(item.progress_fraction),
                "status": _milestone_status(
                    item,
                    progress["progress_percent"],
                    today,
                    campaign.end_date,
                ),
                "completed_at": item.completed_at.isoformat() if item.completed_at else None,
                "coach_snapshot": item.coach_snapshot,
                "approved_asset_key": item.approved_asset_key,
            }
            for item in milestone_rows
        ]
        crew = expedition_crew_summary(
            campaign, progress, today=today, user_id=request.user.pk, milestones=milestone_rows,
        )
        theme = route_theme(campaign.route_theme)
        objective_info = objective(campaign.objective)
        hidden_until_found = campaign.objective == OBJECTIVE_TREASURE
        for item in milestones:
            found = item["status"] == "completed"
            item["title"] = theme["landmarks"].get(item["milestone_id"], item["milestone_id"])
            item["hidden"] = hidden_until_found and not found
            item["story"] = theme["story"].get(item["milestone_id"]) if found else None
            item["stamped"] = next(
                (m.stamped for m in milestone_rows if m.milestone_id == item["milestone_id"]), True,
            )
            if item["hidden"]:
                item["title"] = "?"
        return Response({
            "competition_id": competition.pk,
            "title": competition.name,
            "enabled": campaign.enabled,
            "route_template": campaign.route_template,
            "route_theme": campaign.route_theme or "summit",
            "route_title": theme["title"],
            "landmark_titles": theme["landmarks"],
            "objective": campaign.objective,
            "objective_title": objective_info["title"],
            "objective_tagline": objective_info["tagline"],
            "objective_help": objective_info["help"],
            "start_date": campaign.start_date.isoformat(),
            "end_date": campaign.end_date.isoformat(),
            "locked": campaign.locked_at is not None,
            "participant_count": progress["participant_count"],
            "progress_percent": float(progress["progress_percent"]),
            "route_percent": float(progress.get("route_percent", progress["progress_percent"])),
            "personal_progress_percent": float(progress["personal_progress_percent"]),
            "earned_points": float(progress["earned_points"]),
            "target_points": float(progress["target_points"]),
            "personal_points": float(progress["personal_points"]),
            **crew,
            "finale": finale,
            "current_coach": current_coach,
            "coach_handover": coach_handover,
            "milestones": milestones,
        })


class ExpeditionShortcutVoteView(APIView):
    """Cast (or change) a crew member's vote during the shortcut week."""

    permission_classes = [IsAuthenticated]

    def post(self, request, competition_id):
        choice = str(request.data.get("choice", "")).strip().lower()
        if choice not in SHORTCUT_CHOICES:
            return Response({"detail": "Vote 'ridge' or 'valley'."}, status=400)
        membership = Competition.objects.filter(
            Q(owner=request.user) | Q(user=request.user),
        ).distinct()
        competition = get_object_or_404(membership, pk=competition_id)
        today = timezone.localdate()
        with transaction.atomic():
            campaign = get_object_or_404(
                ExpeditionCampaign.objects.select_for_update().filter(competition=competition, enabled=True),
            )
            if not campaign.locked_at:
                return Response({"detail": "The route has not started yet."}, status=409)
            periods = list(_score_periods(campaign.start_date, campaign.end_date))
            twist = active_twist(campaign, periods, today)
            state = dict(campaign.twist_state or {})
            shortcut = dict(state.get("shortcut") or {})
            if not twist or twist["kind"] != TWIST_SHORTCUT or shortcut.get("result"):
                return Response({"detail": "The shortcut vote is not open."}, status=409)
            participant_ids = set(campaign.participant_ids_snapshot or [])
            if participant_ids and request.user.pk not in participant_ids:
                return Response({"detail": "Only the launch crew votes."}, status=403)
            votes = {str(k): v for k, v in (shortcut.get("votes") or {}).items()}
            votes[str(request.user.pk)] = choice
            shortcut["votes"] = votes
            state["shortcut"] = shortcut
            # Touch updated_at so the next read recomputes instead of serving the 15 s cache.
            ExpeditionCampaign.objects.filter(pk=campaign.pk).update(twist_state=state, updated_at=timezone.now())
            campaign.twist_state = state
            state = settle_shortcut(campaign, periods, participant_ids, today)
        shortcut = state.get("shortcut") or {}
        votes = shortcut.get("votes") or {}
        return Response({
            "your_vote": choice,
            "ridge_votes": sum(1 for v in votes.values() if v == "ridge"),
            "valley_votes": sum(1 for v in votes.values() if v == "valley"),
            "result": shortcut.get("result"),
            "milestone_id": shortcut.get("milestone_id"),
        })

"""Weekly coach vote: eligible personas, countdown, tally + handover."""

import datetime
import logging
import random

from django.db.models import Count, Q
from django.utils import timezone

logger = logging.getLogger(__name__)

SWITCH_HOUR = 7
SWITCH_MINUTE = 15


def next_persona_switch_at(now=None):
    """Next Monday 07:15 in the server timezone (the weekly handover)."""
    now = timezone.localtime(now or timezone.now())
    target = now.replace(hour=SWITCH_HOUR, minute=SWITCH_MINUTE, second=0, microsecond=0)
    days = (0 - now.weekday()) % 7  # Monday = 0
    if days == 0 and now >= target:
        days = 7
    return target + datetime.timedelta(days=days)


def term_started_at(now=None):
    """Monday 07:15 that opened the current term (one week before next)."""
    return next_persona_switch_at(now) - datetime.timedelta(days=7)


def eligible_personas(competition, incumbent_id=None):
    """Built-ins + custom roasters created by current participants + incumbent."""
    from .models import DrillInstructorPersona

    participant_ids = list(competition.user.values_list("id", flat=True))
    ids = set(
        DrillInstructorPersona.objects.filter(
            Q(is_builtin=True) | Q(created_by_id__in=participant_ids)
        ).values_list("pk", flat=True)
    )
    if incumbent_id:
        ids.add(incumbent_id)
    return DrillInstructorPersona.objects.filter(pk__in=ids).order_by("name")


def pick_winner(tallies, incumbent_id):
    """Highest vote count. Ties (including the incumbent) are drawn at random.

    No votes at all keeps the sitting coach.
    """
    if not tallies:
        return incumbent_id
    top_n = tallies[0]["n"]
    tied = [row["persona"] for row in tallies if row["n"] == top_n]
    if len(tied) == 1:
        return tied[0]
    return random.choice(tied)


def ballot_payload_for_request(config, request):
    from .models import DrillInstructorPersonaVote
    from .serializers import DrillInstructorPersonaSerializer

    personas = list(eligible_personas(config.competition, incumbent_id=config.persona_id))
    counts = {
        row["persona"]: row["n"]
        for row in DrillInstructorPersonaVote.objects.filter(config=config)
        .values("persona")
        .annotate(n=Count("id"))
    }
    my_row = DrillInstructorPersonaVote.objects.filter(
        config=config, user=request.user
    ).first()
    my_vote = my_row.persona_id if my_row else None
    max_votes = max(counts.values(), default=0)
    serializer_ctx = {"request": request}
    candidates = []
    for persona in personas:
        votes = counts.get(persona.id, 0)
        data = DrillInstructorPersonaSerializer(persona, context=serializer_ctx).data
        data.pop("system_prompt", None)
        candidates.append({
            "persona": data,
            "votes": votes,
            "leading": bool(max_votes and votes == max_votes),
        })
    candidates.sort(key=lambda c: (-c["votes"], c["persona"]["name"] or ""))
    next_at = next_persona_switch_at()
    changed_at = config.persona_changed_at
    changed_this_term = bool(changed_at and timezone.localtime(changed_at) >= term_started_at())
    previous = None
    if config.previous_persona_id and changed_this_term:
        previous = DrillInstructorPersonaSerializer(
            config.previous_persona, context=serializer_ctx
        ).data
        previous.pop("system_prompt", None)
    return {
        "config": config.id,
        "current_persona": config.persona_id,
        "my_vote": my_vote,
        "next_switch_at": next_at.isoformat(),
        "persona_changed_at": changed_at.isoformat() if changed_at else None,
        "changed_this_term": changed_this_term,
        "previous_persona": previous,
        "candidates": candidates,
        "vote_count": sum(counts.values()),
    }


def apply_persona_votes(config, now=None):
    """Tally one challenge. Returns a result dict. Votes always reset."""
    from .models import DrillInstructorMessage, DrillInstructorPersona, DrillInstructorPersonaVote
    from .tasks import _post_coach_line

    now = now or timezone.now()
    incumbent_id = config.persona_id
    tallies = list(
        DrillInstructorPersonaVote.objects.filter(config=config)
        .values("persona")
        .annotate(n=Count("id"))
        .order_by("-n", "persona")
    )
    winner_id = pick_winner(tallies, incumbent_id)
    switched = winner_id != incumbent_id
    result = {
        "config": config.id,
        "switched": switched,
        "winner": winner_id,
        "votes": {row["persona"]: row["n"] for row in tallies},
    }
    logger.info(
        "Weekly coach vote config=%s incumbent=%s winner=%s switched=%s votes=%s",
        config.id, incumbent_id, winner_id, switched, result["votes"],
    )
    if switched:
        previous = config.persona
        winner = DrillInstructorPersona.objects.get(pk=winner_id)
        config.previous_persona = previous
        config.persona = winner
        config.persona_changed_at = now
        config.save(update_fields=["previous_persona", "persona", "persona_changed_at", "updated_at"])
        prev_name = previous.name if previous else "the bench"
        body = (
            f"{winner.name} has taken the megaphone from {prev_name}. "
            f"One week on duty. Vote below for who coaches next week."
        )
        try:
            _post_coach_line(config, DrillInstructorMessage.KIND_HANDOVER, body)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Coach handover post failed for config %s: %s", config.pk, exc)
    DrillInstructorPersonaVote.objects.filter(config=config).delete()
    return result

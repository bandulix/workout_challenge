"""Head-to-head duels.

Scores are a date window over ``Points.points_capped`` — the same rows the
leaderboard sums — so a duel's total always matches that slice of the board.

A workout counts when its start falls in ``[starts_at, ends_at)``. The
result stays open for ``GRACE_HOURS`` (6) after ``ends_at`` so a session
that already happened can still arrive from Strava, Garmin, or Health
Connect. The first settle after that grace freezes the scores. Later
syncs do not move them.

Pings (accepted, lead change, 24h left, result) go only to the two
duelists. They wait for waking hours (07:00–22:00 site time), follow the
challenge's coach-push opt-in, and are rate-limited per athlete per kind.
"""

from __future__ import annotations

import datetime
import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from competition.models import Duel, DuelBlock, DuelNote, DuelPing
from competition.scorer import quantize_points
from workouts.models import SPORT_TYPES

logger = logging.getLogger(__name__)

GRACE_HOURS = 6
RESPOND_HOURS = 48
MAX_OPEN_DUELS = 2
PING_COOLDOWN_SECONDS = 20 * 60
QUIET_START_HOUR = 7
QUIET_END_HOUR = 22
ALLOWED_DURATIONS = (3, 7, 14)
VALID_SPORTS = {key for key, _label in SPORT_TYPES}

METRIC_LABELS = {
    Duel.METRIC_POINTS: "Challenge points",
    Duel.METRIC_MINUTES: "Minutes",
    Duel.METRIC_SPORT: "Workout type",
}


class DuelError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def athlete_name(user) -> str:
    name = (getattr(user, "first_name", None) or getattr(user, "username", None) or "Athlete")
    return str(name).strip() or "Athlete"


def forfeit_phrase(text: str) -> str:
    """Shorten an agreed forfeit so the result can read 'owes: the beers'."""
    cleaned = (text or "").strip()
    lowered = cleaned.lower()
    for prefix in ("loser buys ", "loser owes ", "loser "):
        if lowered.startswith(prefix):
            rest = cleaned[len(prefix):].strip()
            return rest or cleaned
    return cleaned


def owes_line(loser, forfeit: str) -> str:
    phrase = forfeit_phrase(forfeit)
    if not phrase:
        return ""
    return f"{athlete_name(loser)} owes: {phrase}"


def in_quiet_hours(now=None) -> bool:
    local = timezone.localtime(now or timezone.now())
    return not (QUIET_START_HOUR <= local.hour < QUIET_END_HOUR)


def _aware(dt):
    if dt is None:
        return None
    if timezone.is_naive(dt):
        return timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def competition_bounds(competition):
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.datetime.combine(competition.start_date, datetime.time.min), tz)
    end = timezone.make_aware(datetime.datetime.combine(competition.end_date, datetime.time.max), tz)
    return start, end


def _participants(competition):
    return competition.user.all()


def is_participant(competition, user) -> bool:
    if user is None or not getattr(user, "is_authenticated", True):
        return False
    return _participants(competition).filter(pk=user.pk).exists()


def open_count(user) -> int:
    return Duel.objects.filter(
        Q(challenger=user) | Q(opponent=user),
        status__in=Duel.OPEN_STATUSES,
    ).count()


def _pair_open(a, b):
    return Duel.objects.filter(
        status__in=Duel.OPEN_STATUSES,
    ).filter(
        (Q(challenger=a) & Q(opponent=b)) | (Q(challenger=b) & Q(opponent=a)),
    )


def blocked(blocker, blocked_user) -> bool:
    return DuelBlock.objects.filter(blocker=blocker, blocked=blocked_user).exists()


def _validate_terms(*, duration_days, metric, sport_type, forfeit):
    try:
        duration_days = int(duration_days)
    except (TypeError, ValueError) as exc:
        raise DuelError("Duration must be 3, 7, or 14 days.") from exc
    if duration_days not in ALLOWED_DURATIONS:
        raise DuelError("Duration must be 3, 7, or 14 days.")
    metric = (metric or Duel.METRIC_POINTS).strip()
    if metric not in {Duel.METRIC_POINTS, Duel.METRIC_MINUTES, Duel.METRIC_SPORT}:
        raise DuelError("Pick challenge points, minutes, or a workout type.")
    sport_type = (sport_type or "").strip()
    if metric == Duel.METRIC_SPORT:
        if sport_type not in VALID_SPORTS:
            raise DuelError("Pick a workout type for this duel.")
    else:
        sport_type = ""
    forfeit = (forfeit or "").strip()
    if len(forfeit) > 200:
        raise DuelError("Keep the forfeit under 200 characters.")
    return duration_days, metric, sport_type, forfeit


def _fits_competition(competition, start, duration_days):
    _start_bound, end_bound = competition_bounds(competition)
    if start < _start_bound:
        raise DuelError("This challenge has not started yet.")
    ends = start + datetime.timedelta(days=int(duration_days))
    if ends > end_bound:
        raise DuelError(f"This challenge ends before a {duration_days}-day duel would.")
    return ends


def _push_opt_in(duel) -> bool:
    try:
        config = duel.competition.drill_instructor
    except Exception:
        return False
    return bool(config and config.send_push_on_activity)


def _notify(user, *, duel, kind, title, body, now=None):
    """Web push + Android inbox row. False when skipped so the caller retries."""
    if kind != "lead" and DuelPing.objects.filter(user=user, duel=duel, kind=kind).exists():
        return True
    if not _push_opt_in(duel) or in_quiet_hours(now):
        return False
    try:
        from django.core.cache import cache
        if not cache.add(f"duel-ping:{user.pk}:{kind}", 1, PING_COOLDOWN_SECONDS):
            return False
    except Exception:
        logger.info("Duel ping cooldown unavailable; sending anyway")
    url = f"/duel/{duel.pk}"
    if kind == "lead":
        DuelPing.objects.create(
            user=user, duel=duel, kind=kind, title=title[:120], body=body[:240], url=url,
        )
    else:
        DuelPing.objects.get_or_create(
            user=user, duel=duel, kind=kind,
            defaults={"title": title[:120], "body": body[:240], "url": url},
        )
    try:
        from push_notifications.sender import send_push_to_user
        send_push_to_user(
            user,
            title=title[:120],
            body=body[:240],
            url=url,
            badge="/icon-badge.png",
            tag=f"duel-{duel.pk}-{kind}",
        )
    except Exception:
        logger.warning("Duel web push failed for user %s", user.pk, exc_info=True)
    return True


def _notify_both(duel, *, kind, title, body, now=None):
    ok_a = _notify(duel.challenger, duel=duel, kind=kind, title=title, body=body, now=now)
    ok_b = _notify(duel.opponent, duel=duel, kind=kind, title=title, body=body, now=now)
    return ok_a and ok_b


def _points_qs(duel, user_id):
    from competition.models import Points

    qs = Points.objects.filter(
        Q(goal__competition_id=duel.competition_id) | Q(award__competition_id=duel.competition_id),
        workout__user_id=user_id,
        workout__start_datetime__gte=duel.starts_at,
        workout__start_datetime__lt=duel.ends_at,
    )
    if duel.metric == Duel.METRIC_SPORT and duel.sport_type:
        qs = qs.filter(workout__sport_type=duel.sport_type)
    elif duel.metric == Duel.METRIC_MINUTES:
        qs = qs.filter(goal__metric="min")
    return qs


def score_athlete(duel, user_id) -> Decimal:
    if not duel.starts_at or not duel.ends_at:
        return Decimal("0.00")
    total = _points_qs(duel, user_id).aggregate(total=Sum("points_capped"))["total"]
    return quantize_points(total or 0)


def live_scores(duel):
    if duel.finalized_at:
        return quantize_points(duel.challenger_score), quantize_points(duel.opponent_score)
    return score_athlete(duel, duel.challenger_id), score_athlete(duel, duel.opponent_id)


def _daily_map(duel, user_id):
    rows = (
        _points_qs(duel, user_id)
        .annotate(day=TruncDate("workout__start_datetime", tzinfo=timezone.get_current_timezone()))
        .values("day")
        .annotate(total=Sum("points_capped"))
    )
    out = {}
    for row in rows:
        day = row["day"]
        if day is None:
            continue
        out[day.isoformat()] = str(quantize_points(row["total"] or 0))
    return out


def window_days(duel):
    if not duel.starts_at or not duel.ends_at:
        return []
    start = timezone.localtime(duel.starts_at).date()
    last_instant = duel.ends_at - datetime.timedelta(microseconds=1)
    last = timezone.localtime(last_instant).date()
    days = []
    cursor = start
    while cursor <= last and len(days) < 21:
        days.append(cursor)
        cursor += datetime.timedelta(days=1)
    return days


def _leader_id(challenger_score, opponent_score, duel):
    if challenger_score > opponent_score:
        return duel.challenger_id
    if opponent_score > challenger_score:
        return duel.opponent_id
    return None


def record_for(user_id) -> dict:
    return records_for([user_id]).get(user_id, {"wins": 0, "losses": 0, "ties": 0})


def records_for(user_ids) -> dict:
    base = {uid: {"wins": 0, "losses": 0, "ties": 0} for uid in user_ids}
    if not user_ids:
        return base
    rows = Duel.objects.filter(status=Duel.STATUS_COMPLETED).filter(
        Q(challenger_id__in=user_ids) | Q(opponent_id__in=user_ids),
    ).only("challenger_id", "opponent_id", "result")
    id_set = set(user_ids)
    for duel in rows:
        for uid, role in ((duel.challenger_id, "challenger"), (duel.opponent_id, "opponent")):
            if uid not in id_set:
                continue
            bucket = base[uid]
            if duel.result == Duel.RESULT_TIE:
                bucket["ties"] += 1
            elif duel.result == role:
                bucket["wins"] += 1
            elif duel.result:
                bucket["losses"] += 1
    return base


def _completed_history(user_id):
    return list(
        Duel.objects.filter(status=Duel.STATUS_COMPLETED)
        .filter(Q(challenger_id=user_id) | Q(opponent_id=user_id))
        .order_by("finalized_at", "pk")
        .only("id", "challenger_id", "opponent_id", "result", "finalized_at")
    )


def _outcome(duel, user_id):
    if duel.result == Duel.RESULT_TIE:
        return "tie"
    if duel.result == Duel.RESULT_CHALLENGER and user_id == duel.challenger_id:
        return "win"
    if duel.result == Duel.RESULT_OPPONENT and user_id == duel.opponent_id:
        return "win"
    if duel.result:
        return "loss"
    return ""


def _award_tags_for_result(duel):
    from drill_instructor.game import award_tag

    for user in (duel.challenger, duel.opponent):
        history = _completed_history(user.pk)
        wins = sum(1 for row in history if _outcome(row, user.pk) == "win")
        if wins >= 3:
            award_tag(user, "duel_three_wins")
        streak = 0
        for row in reversed(history):
            if _outcome(row, user.pk) != "win":
                break
            streak += 1
        if streak >= 5:
            award_tag(user, "duel_streak_five")
        if _outcome(duel, user.pk) != "win":
            continue
        other_id = duel.opponent_id if user.pk == duel.challenger_id else duel.challenger_id
        lost_before = any(
            row.pk != duel.pk
            and {row.challenger_id, row.opponent_id} == {user.pk, other_id}
            and _outcome(row, user.pk) == "loss"
            for row in history
        )
        if lost_before:
            award_tag(user, "duel_revenge")


def _award_first_duel(duel):
    from drill_instructor.game import award_tag
    award_tag(duel.challenger, "first_duel")
    award_tag(duel.opponent, "first_duel")


def _fallback_line(duel, kind) -> str:
    a = athlete_name(duel.challenger)
    b = athlete_name(duel.opponent)
    language = "en"
    try:
        language = (duel.competition.drill_instructor.persona.language or "en").lower()
    except Exception:
        language = "en"
    german = language == "de"
    if kind == DuelNote.KIND_ACCEPTED:
        return (
            f"@{a} gegen @{b}. Sieben Tage, ein Brett, kein Publikum. Los."
            if german and duel.duration_days == 7
            else f"@{a} gegen @{b}. {duel.duration_days} Tage, ein Brett, kein Publikum."
            if german
            else f"@{a} versus @{b}. {duel.duration_days} days, one board, no crowd. Move."
        )
    if kind == DuelNote.KIND_DAY_LEFT:
        return (
            f"Noch ein Tag, @{a} und @{b}. Wer jetzt geht, schreibt das Ende."
            if german
            else f"One day left, @{a} and @{b}. Whoever moves now writes the ending."
        )
    if kind == DuelNote.KIND_RESULT:
        if duel.result == Duel.RESULT_TIE:
            return (
                f"Unentschieden. @{a} und @{b} hören gleichzeitig auf. Respekt."
                if german
                else f"A tie. @{a} and @{b} finish level. Respect."
            )
        winner = a if duel.result == Duel.RESULT_CHALLENGER else b
        other = b if winner == a else a
        return (
            f"@{winner} liegt vorn, @{other} hat mitgehalten. Sauber gefochten."
            if german
            else f"@{winner} takes it. @{other} made them earn it. Clean fight."
        )
    # lead
    c_score, o_score = live_scores(duel)
    if c_score == o_score:
        return (
            f"Gleichstand, @{a} und @{b}. Niemand sitzt."
            if german
            else f"Level, @{a} and @{b}. Nobody sits this out."
        )
    leader = a if c_score > o_score else b
    trailer = b if leader == a else a
    return (
        f"@{leader} liegt vorn, @{trailer} ist noch im Rennen."
        if german
        else f"@{leader} has the lead. @{trailer} is still in it."
    )


def compose_commentary(duel, kind) -> str:
    """Persona line for the two duelists. Falls back when the LLM is absent."""
    fallback = _fallback_line(duel, kind)
    text = None
    try:
        config = duel.competition.drill_instructor
    except Exception:
        config = None
    if config and config.enabled and config.persona_id:
        persona = config.persona
        a = athlete_name(duel.challenger)
        b = athlete_name(duel.opponent)
        c_score, o_score = live_scores(duel)
        prompt = (
            f"Two athletes are in a private duel. Trash-talk both sides playfully. "
            f"Never cruel, never shame a loss, never mention money. "
            f"Athlete A @{a} has {c_score} points. Athlete B @{b} has {o_score} points. "
            f"Moment: {kind}. Duration: {duel.duration_days} days. "
            f"Name both by @FirstName."
        )
        try:
            from drill_instructor.llm_client import generate_message
            text, _reason = generate_message(
                system_prompt=persona.system_prompt,
                user_prompt=prompt,
                language=persona.language,
                require_athlete_name=True,
                max_tokens=180,
            )
        except Exception:
            logger.info("Duel commentary fell back", exc_info=True)
            text = None
    body = (text or "").strip() or fallback
    if kind == DuelNote.KIND_LEAD:
        DuelNote.objects.create(duel=duel, kind=kind, body=body)
        return body
    note = DuelNote.objects.filter(duel=duel, kind=kind).order_by("-pk").first()
    if note is None:
        DuelNote.objects.create(duel=duel, kind=kind, body=body)
    elif text and note.body != body:
        note.body = body
        note.save(update_fields=["body"])
    return body


def _maybe_feed_post(duel):
    if duel.feed_posted:
        return
    if not (duel.challenger_feed_opt_in and duel.opponent_feed_opt_in):
        return
    try:
        config = duel.competition.drill_instructor
    except Exception:
        return
    if not config or not config.enabled:
        return
    a = athlete_name(duel.challenger)
    b = athlete_name(duel.opponent)
    if duel.result == Duel.RESULT_TIE:
        body = f"{a} and {b} finished a {duel.duration_days}-day duel level."
    else:
        winner = a if duel.result == Duel.RESULT_CHALLENGER else b
        body = f"{a} and {b} wrapped a {duel.duration_days}-day duel. {winner} finished ahead."
    if duel.forfeit and duel.challenger_forfeit_public and duel.opponent_forfeit_public:
        body = f"{body} They agreed: {duel.forfeit.strip()}."
    from drill_instructor.models import DrillInstructorMessage
    DrillInstructorMessage.objects.create(
        config=config,
        persona=config.persona,
        kind=DrillInstructorMessage.KIND_DUEL,
        body=body,
        success=True,
    )
    duel.feed_posted = True
    duel.save(update_fields=["feed_posted", "updated_at"])


def _finalize(duel, now):
    c_score = score_athlete(duel, duel.challenger_id)
    o_score = score_athlete(duel, duel.opponent_id)
    if c_score > o_score:
        result = Duel.RESULT_CHALLENGER
    elif o_score > c_score:
        result = Duel.RESULT_OPPONENT
    else:
        result = Duel.RESULT_TIE
    duel.challenger_score = c_score
    duel.opponent_score = o_score
    duel.result = result
    duel.status = Duel.STATUS_COMPLETED
    duel.finalized_at = now
    duel.daily_snapshot = {
        "challenger": _daily_map(duel, duel.challenger_id),
        "opponent": _daily_map(duel, duel.opponent_id),
    }
    duel.save(update_fields=[
        "challenger_score", "opponent_score", "result", "status",
        "finalized_at", "daily_snapshot", "updated_at",
    ])
    _award_tags_for_result(duel)
    compose_commentary(duel, DuelNote.KIND_RESULT)
    _maybe_feed_post(duel)


def _ping_accepted(duel, now=None):
    if duel.pinged_accepted or duel.status != Duel.STATUS_ACTIVE:
        return
    title = "Duel on"
    body = f"{athlete_name(duel.challenger)} vs {athlete_name(duel.opponent)} — {duel.duration_days} days."
    if _notify_both(duel, kind="accepted", title=title, body=body, now=now):
        duel.pinged_accepted = True
        duel.save(update_fields=["pinged_accepted", "updated_at"])


def _ping_24h(duel, now):
    if duel.pinged_24h or duel.finalized_at or not duel.ends_at:
        return
    remaining = duel.ends_at - now
    if not (datetime.timedelta(0) < remaining <= datetime.timedelta(hours=24)):
        return
    if _notify_both(duel, kind="day_left", title="24 hours left", body="One day left in your duel.", now=now):
        duel.pinged_24h = True
        duel.save(update_fields=["pinged_24h", "updated_at"])
        compose_commentary(duel, DuelNote.KIND_DAY_LEFT)


def _ping_lead(duel, now=None):
    if duel.finalized_at or duel.status != Duel.STATUS_ACTIVE:
        return
    c_score, o_score = live_scores(duel)
    if c_score == 0 and o_score == 0 and duel.leader_id is None:
        return
    current = _leader_id(c_score, o_score, duel)
    if current == duel.leader_id:
        return
    if current is None:
        body = "You're level. Nobody has this yet."
    else:
        body = "The lead just changed."
    if _notify_both(duel, kind="lead", title="Duel lead", body=body, now=now):
        duel.leader_id = current
        duel.save(update_fields=["leader_id", "updated_at"])
        compose_commentary(duel, DuelNote.KIND_LEAD)


def _ping_result(duel, now=None):
    if not duel.finalized_at or duel.pinged_result:
        return
    if duel.result == Duel.RESULT_TIE:
        body = "Your duel finished level."
    else:
        body = "Your duel has a result."
    if _notify_both(duel, kind="result", title="Duel over", body=body, now=now):
        duel.pinged_result = True
        duel.save(update_fields=["pinged_result", "updated_at"])


def settle_duel(duel, now=None):
    now = now or timezone.now()
    with transaction.atomic():
        locked = (
            Duel.objects.select_for_update()
            .select_related("competition", "challenger", "opponent")
            .get(pk=duel.pk)
        )
        if locked.status in (Duel.STATUS_PENDING, Duel.STATUS_COUNTERED):
            if locked.respond_by and locked.respond_by <= now:
                locked.status = Duel.STATUS_EXPIRED
                locked.save(update_fields=["status", "updated_at"])
            return locked
        if locked.status != Duel.STATUS_ACTIVE:
            return locked
        if locked.finalized_at is None and locked.grace_until and now >= locked.grace_until:
            _finalize(locked, now)
            locked.refresh_from_db()
        if locked.finalized_at:
            _ping_result(locked, now)
            return locked
        _ping_accepted(locked, now)
        locked.refresh_from_db()
        _ping_24h(locked, now)
        locked.refresh_from_db()
        _ping_lead(locked, now)
        return Duel.objects.select_related("competition", "challenger", "opponent").get(pk=locked.pk)


def settle_due_duels(now=None) -> dict:
    now = now or timezone.now()
    due = Duel.objects.filter(
        Q(status__in=[Duel.STATUS_PENDING, Duel.STATUS_COUNTERED], respond_by__lte=now)
        | Q(status=Duel.STATUS_ACTIVE),
    ).values_list("pk", flat=True)
    settled = 0
    for pk in list(due):
        try:
            settle_duel(Duel.objects.get(pk=pk), now=now)
            settled += 1
        except Exception:
            logger.exception("Duel settle failed for %s", pk)
    return {"settled": settled}


def _set_flag(duel, user, field_challenger, field_opponent, value):
    if value is None:
        return
    flag = bool(value)
    if user.pk == duel.challenger_id:
        setattr(duel, field_challenger, flag)
    else:
        setattr(duel, field_opponent, flag)


@transaction.atomic
def create_duel(
    *,
    competition,
    challenger,
    opponent_id,
    duration_days=7,
    metric=Duel.METRIC_POINTS,
    sport_type="",
    forfeit="",
    forfeit_public=False,
    feed_opt_in=False,
    rematch_of=None,
    now=None,
):
    now = now or timezone.now()
    if not is_participant(competition, challenger):
        raise DuelError("Join this challenge before challenging someone.", 403)
    try:
        opponent_id = int(opponent_id)
    except (TypeError, ValueError) as exc:
        raise DuelError("Pick someone in this challenge.") from exc
    opponent = _participants(competition).filter(pk=opponent_id).first()
    if opponent is None or opponent.pk == challenger.pk:
        raise DuelError("Pick someone else in this challenge.")
    if blocked(opponent, challenger):
        raise DuelError("You can't challenge this athlete right now.", 403)
    duration_days, metric, sport_type, forfeit = _validate_terms(
        duration_days=duration_days, metric=metric, sport_type=sport_type, forfeit=forfeit,
    )
    _fits_competition(competition, now, duration_days)
    # Lock the open rows we are about to count.
    list(Duel.objects.select_for_update().filter(
        Q(challenger=challenger) | Q(opponent=challenger) | Q(challenger=opponent) | Q(opponent=opponent),
        status__in=Duel.OPEN_STATUSES,
    ))
    if open_count(challenger) >= MAX_OPEN_DUELS:
        raise DuelError("You already have two open duels.", 409)
    if open_count(opponent) >= MAX_OPEN_DUELS:
        raise DuelError(f"{athlete_name(opponent)} already has two open duels.", 409)
    if _pair_open(challenger, opponent).exists():
        raise DuelError("You already have an open duel with this athlete.", 409)
    return Duel.objects.create(
        competition=competition,
        challenger=challenger,
        opponent=opponent,
        proposed_by=challenger,
        awaiting=opponent,
        status=Duel.STATUS_PENDING,
        duration_days=duration_days,
        metric=metric,
        sport_type=sport_type,
        forfeit=forfeit,
        challenger_forfeit_public=bool(forfeit_public),
        challenger_feed_opt_in=bool(feed_opt_in),
        respond_by=now + datetime.timedelta(hours=RESPOND_HOURS),
        rematch_of=rematch_of,
    )


def _require_duelist(duel, user):
    if user.pk not in (duel.challenger_id, duel.opponent_id):
        raise DuelError("Not found.", 404)


def _other(duel, user):
    return duel.opponent if user.pk == duel.challenger_id else duel.challenger


@transaction.atomic
def respond(duel, user, *, action, duration_days=None, forfeit=None, forfeit_public=None, feed_opt_in=None, now=None):
    now = now or timezone.now()
    locked = Duel.objects.select_for_update().select_related("competition", "challenger", "opponent").get(pk=duel.pk)
    _require_duelist(locked, user)
    if locked.status not in (Duel.STATUS_PENDING, Duel.STATUS_COUNTERED):
        raise DuelError("This duel is no longer waiting on a reply.")
    if locked.respond_by and locked.respond_by <= now:
        locked.status = Duel.STATUS_EXPIRED
        locked.save(update_fields=["status", "updated_at"])
        raise DuelError("This duel invite expired.")
    action = (action or "").strip().lower()
    if action == "withdraw":
        locked.status = Duel.STATUS_CANCELLED
        locked.save(update_fields=["status", "updated_at"])
        return locked
    if locked.awaiting_id != user.pk:
        raise DuelError("Waiting on the other athlete.")
    _set_flag(locked, user, "challenger_forfeit_public", "opponent_forfeit_public", forfeit_public)
    _set_flag(locked, user, "challenger_feed_opt_in", "opponent_feed_opt_in", feed_opt_in)
    if action == "decline":
        locked.status = Duel.STATUS_DECLINED
        locked.save()
        return locked
    if action == "counter":
        new_duration = duration_days if duration_days is not None else locked.duration_days
        new_forfeit = forfeit if forfeit is not None else locked.forfeit
        new_duration, metric, sport_type, new_forfeit = _validate_terms(
            duration_days=new_duration,
            metric=locked.metric,
            sport_type=locked.sport_type,
            forfeit=new_forfeit,
        )
        if new_duration == locked.duration_days and new_forfeit == locked.forfeit:
            raise DuelError("Change the duration or the forfeit to counter.")
        _fits_competition(locked.competition, now, new_duration)
        locked.duration_days = new_duration
        locked.metric = metric
        locked.sport_type = sport_type
        locked.forfeit = new_forfeit
        locked.proposed_by = user
        locked.awaiting = _other(locked, user)
        locked.status = Duel.STATUS_COUNTERED
        locked.respond_by = now + datetime.timedelta(hours=RESPOND_HOURS)
        locked.save()
        return locked
    if action != "accept":
        raise DuelError("Accept, decline, or counter.")
    ends = _fits_competition(locked.competition, now, locked.duration_days)
    locked.status = Duel.STATUS_ACTIVE
    locked.starts_at = now
    locked.ends_at = ends
    locked.grace_until = ends + datetime.timedelta(hours=GRACE_HOURS)
    locked.save()
    _award_first_duel(locked)
    compose_commentary(locked, DuelNote.KIND_ACCEPTED)
    _ping_accepted(locked, now)
    return Duel.objects.select_related("competition", "challenger", "opponent").get(pk=locked.pk)


def _loser_winner(duel):
    if duel.result == Duel.RESULT_CHALLENGER:
        return duel.opponent, duel.challenger
    if duel.result == Duel.RESULT_OPPONENT:
        return duel.challenger, duel.opponent
    return None, None


@transaction.atomic
def mark_forfeit_paid(duel, user, now=None):
    now = now or timezone.now()
    locked = Duel.objects.select_for_update().select_related("challenger", "opponent").get(pk=duel.pk)
    _require_duelist(locked, user)
    if locked.status != Duel.STATUS_COMPLETED or not locked.forfeit or locked.result == Duel.RESULT_TIE:
        raise DuelError("There is no forfeit to mark.")
    loser, _winner = _loser_winner(locked)
    if user.pk != loser.pk:
        raise DuelError("Only the athlete who owes it can mark it paid.", 403)
    locked.forfeit_marked_at = now
    locked.save(update_fields=["forfeit_marked_at", "updated_at"])
    return locked


@transaction.atomic
def confirm_forfeit(duel, user, now=None):
    now = now or timezone.now()
    locked = Duel.objects.select_for_update().select_related("challenger", "opponent").get(pk=duel.pk)
    _require_duelist(locked, user)
    if locked.status != Duel.STATUS_COMPLETED or not locked.forfeit or locked.result == Duel.RESULT_TIE:
        raise DuelError("There is no forfeit to confirm.")
    _loser, winner = _loser_winner(locked)
    if user.pk != winner.pk:
        raise DuelError("Only the other athlete can confirm.", 403)
    if not locked.forfeit_marked_at:
        raise DuelError("It has not been marked paid yet.")
    locked.forfeit_confirmed_at = now
    locked.save(update_fields=["forfeit_confirmed_at", "updated_at"])
    return locked


def rematch(duel, user, now=None):
    if duel.status != Duel.STATUS_COMPLETED:
        raise DuelError("Finish this duel before a rematch.")
    _require_duelist(duel, user)
    other = _other(duel, user)
    mine_public = duel.challenger_forfeit_public if user.pk == duel.challenger_id else duel.opponent_forfeit_public
    mine_feed = duel.challenger_feed_opt_in if user.pk == duel.challenger_id else duel.opponent_feed_opt_in
    return create_duel(
        competition=duel.competition,
        challenger=user,
        opponent_id=other.pk,
        duration_days=duel.duration_days,
        metric=duel.metric,
        sport_type=duel.sport_type,
        forfeit=duel.forfeit,
        forfeit_public=mine_public,
        feed_opt_in=mine_feed,
        rematch_of=duel,
        now=now,
    )


def set_block(blocker, blocked_id, *, blocked=True):
    from custom_user.models import CustomUser
    try:
        blocked_id = int(blocked_id)
    except (TypeError, ValueError) as exc:
        raise DuelError("Pick an athlete.") from exc
    if blocked_id == blocker.pk:
        raise DuelError("You can't block yourself.")
    other = CustomUser.objects.filter(pk=blocked_id).first()
    if other is None:
        raise DuelError("Pick an athlete.", 404)
    if blocked:
        DuelBlock.objects.get_or_create(blocker=blocker, blocked=other)
    else:
        DuelBlock.objects.filter(blocker=blocker, blocked=other).delete()
    return other


def _picture(user):
    from custom_user.serializers import user_picture_url
    return user_picture_url(user)


def _person(user, score=None):
    payload = {
        "id": user.pk,
        "username": user.username,
        "first_name": user.first_name,
        "profile_picture": _picture(user),
    }
    if score is not None:
        payload["score"] = float(score)
    return payload


def _coach_payload(duel):
    try:
        config = duel.competition.drill_instructor
    except Exception:
        return None
    if not config or not config.persona_id:
        return None
    persona = config.persona
    return {
        "name": persona.name,
        "avatar": persona.avatar,
        "theme_color": persona.theme_color,
        "language": persona.language,
    }


def serialize_duel(duel, viewer, *, detailed=False, now=None):
    now = now or timezone.now()
    you_are = "challenger" if viewer.pk == duel.challenger_id else "opponent"
    c_score, o_score = live_scores(duel) if duel.starts_at else (Decimal("0.00"), Decimal("0.00"))
    you_score = c_score if you_are == "challenger" else o_score
    them_score = o_score if you_are == "challenger" else c_score
    you_user = duel.challenger if you_are == "challenger" else duel.opponent
    them_user = duel.opponent if you_are == "challenger" else duel.challenger
    loser, _winner = _loser_winner(duel) if duel.result else (None, None)
    forfeit_line = ""
    if duel.forfeit and loser is not None:
        forfeit_line = owes_line(loser, duel.forfeit)
    seconds_remaining = 0
    grace_seconds = 0
    in_grace = False
    if duel.status == Duel.STATUS_ACTIVE and duel.ends_at:
        if now < duel.ends_at:
            seconds_remaining = int((duel.ends_at - now).total_seconds())
        elif duel.grace_until and now < duel.grace_until and not duel.finalized_at:
            in_grace = True
            grace_seconds = int((duel.grace_until - now).total_seconds())
    your_public = duel.challenger_forfeit_public if you_are == "challenger" else duel.opponent_forfeit_public
    their_public = duel.opponent_forfeit_public if you_are == "challenger" else duel.challenger_forfeit_public
    your_feed = duel.challenger_feed_opt_in if you_are == "challenger" else duel.opponent_feed_opt_in
    their_feed = duel.opponent_feed_opt_in if you_are == "challenger" else duel.challenger_feed_opt_in
    sport_label = ""
    if duel.sport_type:
        sport_label = dict(SPORT_TYPES).get(duel.sport_type, duel.sport_type)
    payload = {
        "id": duel.pk,
        "competition_id": duel.competition_id,
        "competition_name": duel.competition.name,
        "status": duel.status,
        "you_are": you_are,
        "awaiting_you": duel.awaiting_id == viewer.pk and duel.status in (Duel.STATUS_PENDING, Duel.STATUS_COUNTERED),
        "duration_days": duel.duration_days,
        "metric": duel.metric,
        "metric_label": sport_label or METRIC_LABELS.get(duel.metric, duel.metric),
        "sport_type": duel.sport_type,
        "forfeit": duel.forfeit,
        "forfeit_public": bool(duel.challenger_forfeit_public and duel.opponent_forfeit_public),
        "your_forfeit_public": your_public,
        "their_forfeit_public": their_public,
        "your_feed_opt_in": your_feed,
        "their_feed_opt_in": their_feed,
        "respond_by": duel.respond_by.isoformat() if duel.respond_by else None,
        "starts_at": duel.starts_at.isoformat() if duel.starts_at else None,
        "ends_at": duel.ends_at.isoformat() if duel.ends_at else None,
        "grace_until": duel.grace_until.isoformat() if duel.grace_until else None,
        "you": _person(you_user, you_score if duel.starts_at or duel.finalized_at else None),
        "them": _person(them_user, them_score if duel.starts_at or duel.finalized_at else None),
        "gap": float(quantize_points(you_score - them_score)) if duel.starts_at or duel.finalized_at else 0,
        "leader": (
            "tied" if you_score == them_score else "you" if you_score > them_score else "them"
        ) if (duel.starts_at or duel.finalized_at) else "tied",
        "seconds_remaining": seconds_remaining,
        "in_grace": in_grace,
        "grace_seconds_remaining": grace_seconds,
        "result": duel.result,
        "forfeit_line": forfeit_line,
        "can_mark_paid": bool(
            loser and viewer.pk == loser.pk and duel.forfeit and not duel.forfeit_marked_at
            and duel.result != Duel.RESULT_TIE and duel.status == Duel.STATUS_COMPLETED
        ),
        "can_confirm_paid": bool(
            duel.forfeit_marked_at and not duel.forfeit_confirmed_at and duel.result != Duel.RESULT_TIE
            and duel.status == Duel.STATUS_COMPLETED and loser and viewer.pk != loser.pk
        ),
        "forfeit_marked": bool(duel.forfeit_marked_at),
        "forfeit_confirmed": bool(duel.forfeit_confirmed_at),
        "can_rematch": duel.status == Duel.STATUS_COMPLETED,
        "coach": _coach_payload(duel),
    }
    if detailed:
        if duel.finalized_at and duel.daily_snapshot:
            c_map = duel.daily_snapshot.get("challenger") or {}
            o_map = duel.daily_snapshot.get("opponent") or {}
        elif duel.starts_at:
            c_map = _daily_map(duel, duel.challenger_id)
            o_map = _daily_map(duel, duel.opponent_id)
        else:
            c_map, o_map = {}, {}
        you_map = c_map if you_are == "challenger" else o_map
        them_map = o_map if you_are == "challenger" else c_map
        payload["daily"] = [
            {
                "date": day.isoformat(),
                "you": float(you_map.get(day.isoformat()) or 0),
                "them": float(them_map.get(day.isoformat()) or 0),
            }
            for day in window_days(duel)
        ]
        payload["commentary"] = [
            {"kind": note.kind, "body": note.body, "at": note.created_at.isoformat()}
            for note in duel.notes.all()
        ]
    return payload

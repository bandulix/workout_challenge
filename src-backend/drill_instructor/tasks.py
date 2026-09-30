import datetime
import logging
import os

from django.apps import apps
from django.core.cache import cache
from django.db.models import F, Sum
from django.utils import timezone

from workout_challenge.celery import app, is_task_already_executing

from .formatters import format_workout_summary
from .llm_client import build_echo_art_prompt, build_photo_prompt, build_reply_prompt, build_roast_caption_prompt, build_roast_image_prompt, check_image_edit_capability, check_vision_capability, draw_roast_treatment, generate_message, generate_roast_image, invent_coach_appearance, invent_roast_twist, max_roast_reference_images

try:
    from push_notifications.sender import send_push_to_user
except ImportError:  # pragma: no cover - keeps the module importable for tests
    send_push_to_user = None

logger = logging.getLogger(__name__)

# Two coach events in the same breath (workout comment + Echo mint,
# catch-up pep talks, overlapping beat jobs) must not land as two lock
# screen pings. Same tag so the OS replaces; short cooldown so we do
# not even send the second.
COACH_PING_COOLDOWN = 120


def _feed_url(message):
    """Open the challenge feed on the thread this ping is about (#15)."""
    root_id = message.parent_id or message.pk
    return f"/competition/{message.config.competition_id}?tab=feed&reply={root_id}"


def _ping_user(user, *, title, body, url, icon, competition_id, log_label="push"):
    if send_push_to_user is None:
        return
    try:
        send_push_to_user(
            user,
            title=title,
            body=body,
            url=url,
            icon=icon,
            badge="/icon-badge.png",
            tag=f"drill-{competition_id}",
            cooldown_seconds=COACH_PING_COOLDOWN,
            cooldown_key=f"coach-ping:{user.pk}",
        )
    except Exception as exc:  # noqa: BLE001 - never block the caller
        logger.warning("Drill Instructor: %s failed for user %s: %s", log_label, user.pk, exc)


@app.task(bind=True, max_retries=0, time_limit=120)
def probe_llm_capabilities(self):
    """Fill the capability cache in the background.

    Queued by the config serializer on a cache miss (throttled via a
    short-lived marker) - the probes make real HTTP calls and must not
    run inside an API request. Idempotent: the check functions are
    cached, so repeat runs are nearly free.
    """
    from .llm_client import check_image_edit_capability, check_vision_capability
    check_vision_capability()
    check_image_edit_capability()
    return {"done": True}


# How much of a thread the coach re-reads before answering. Whole short
# threads fit; long ones keep the most recent turns (the prompt builder
# says how many were dropped so the coach knows there is more history).
THREAD_HISTORY_LIMIT = 12


def _thread_history(root, before=None, limit=THREAD_HISTORY_LIMIT):
    """The thread under ``root`` as prompt-ready entries, oldest first.

    Every direct child posted before ``before`` counts: participant
    replies, participant photos (rendered as a photo marker plus caption
    so a wordless picture still shows up as a turn), the coach's own
    reactions and its remixed posters. Only the last ``limit`` entries are
    returned, with ``dropped`` telling the caller how many older turns
    were cut.
    """
    queryset = root.replies.select_related("user").order_by("posted_at", "pk")
    if before is not None:
        queryset = queryset.filter(posted_at__lte=before.posted_at).exclude(pk=before.pk)
    turns = list(queryset)
    dropped = max(0, len(turns) - limit)
    entries = []
    for m in turns[dropped:]:
        is_coach = m.user_id is None
        entries.append({
            "is_coach": is_coach,
            "author": None if is_coach else (m.user.first_name or m.user.username),
            "body": m.body or "",
            "has_image": bool(m.image),
        })
    return {"entries": entries, "dropped": dropped}


def _persona_icon(persona):
    """Push-notification icon for a persona. Custom uploaded pictures are
    NOT used: they live behind the authenticated picture endpoint, and the
    browser fetches notification icons without credentials. Built-in
    artwork key, else no icon."""
    import re as _re

    if persona.avatar and _re.fullmatch(r"[a-z0-9_-]+", persona.avatar):
        return f"/personas/{persona.avatar}.svg"
    return None


def _echo_lines(config):
    try:
        from .echoes import live_echo_lines
        return live_echo_lines(config)
    except Exception:  # noqa: BLE001
        return []


def _flag_message_failure(message, config, exc, label):
    """Standard coach-message failure path: flag the message (best-effort
    resave so the error is inspectable in the audit log), note the error
    on the config, and log it. Never raises - a broken coach line must
    not block workout saves or sweep the whole beat job."""
    message.success = False
    message.error = str(exc)[:2000]
    try:
        message.save()
    except Exception:  # noqa: BLE001 - pragma: no cover - the config note below still lands
        logger.debug("Drill Instructor: could not resave failed message", exc_info=True)
    config.last_error = str(exc)[:2000]
    config.save(update_fields=["last_error", "updated_at"])
    logger.warning("Drill Instructor: %s save failed for competition %s: %s", label, config.competition_id, exc)


def _record_post(config, now, error=None):
    """Count a posted coach line on the config.

    Several tasks (workout comment, reaction, roast, beat jobs) post for
    the same config concurrently; a read-modify-write of
    ``messages_posted`` on the in-memory instance loses increments, so the
    counter is bumped in SQL. ``error=None`` leaves ``last_error`` alone
    (roasts / photo lines never reset it), a string overwrites it. The
    in-memory instance is refreshed so callers keep reading current values.
    """
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
    values = {
        "messages_posted": F("messages_posted") + 1,
        "last_posted_at": now,
        "updated_at": now,
    }
    fields = ["messages_posted", "last_posted_at", "updated_at"]
    if error is not None:
        values["last_error"] = error
        fields.append("last_error")
    DrillInstructorConfig.objects.filter(pk=config.pk).update(**values)
    config.refresh_from_db(fields=fields)


def _user_rank(workout, competition):
    """Compute this user's rank, totals and the leaderboard "target" user.

    Returns ``(rank, total_participants, my_total, leader_total, target_user)``.

    ``target_user`` is the person the instructor should address in the
    message:
      * if the athlete is not leading, the leader
      * if the athlete IS leading, the runner-up (so we have someone
        to call out for the leader to "watch out for")

    Falls back to ``None`` if the competition has fewer than two
    scored participants.
    """
    Points = apps.get_model("competition", "Points")

    per_user = list(
        Points.objects
        .filter(goal__competition=competition)
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
        .order_by("-total")
    )

    # my_total comes from the same annotated rows - no separate
    # aggregate query (absent user => 0, identical semantics).
    my_total = next(
        (entry["total"] or 0 for entry in per_user if entry["workout__user"] == workout.user_id),
        0,
    )

    if not per_user:
        return None, 0, 0, 0, None

    leader_total = per_user[0]["total"] or 0
    target_user_id = None
    if per_user[0]["workout__user"] == workout.user_id and len(per_user) > 1:
        target_user_id = per_user[1]["workout__user"]
    elif per_user[0]["workout__user"] != workout.user_id:
        target_user_id = per_user[0]["workout__user"]

    target_user = None
    if target_user_id is not None:
        CustomUser = apps.get_model("custom_user", "CustomUser")
        target_user = CustomUser.objects.filter(pk=target_user_id).first()

    if my_total == 0:
        return None, len(per_user), 0, leader_total, target_user

    ahead = sum(1 for entry in per_user if (entry["total"] or 0) > my_total)
    return ahead + 1, len(per_user), my_total, leader_total, target_user


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def post_workout_comment(self, workout_id):
    """Create a neutral activity thread, then process independent game events.

    Generic AI workout chatter and its pushes are retired. The activity
    thread remains the authenticated anchor for workout photos and Echoes;
    its workout card is the activity itself, not a generated comment.
    """
    Workout = apps.get_model("workouts", "Workout")
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    try:
        workout = Workout.objects.select_related("user").get(pk=workout_id)
    except Workout.DoesNotExist:
        logger.info("Drill Instructor: workout %s no longer exists, skipping.", workout_id)
        return {"skipped": "workout_missing"}

    start_dt = workout.start_datetime
    if isinstance(start_dt, str):
        start_dt = datetime.datetime.fromisoformat(start_dt.replace("Z", "+00:00"))
    start_day = timezone.localtime(start_dt).date() if timezone.is_aware(start_dt) else start_dt.date()

    Competition = apps.get_model("competition", "Competition")
    # Generic per-workout coach comments are retired. Material standings
    # changes are announced after point caps are recalculated; game and Echo
    # events continue through the independent lifecycle below.
    competitions = Competition.objects.none()
    posted = 0

    # Arcade rules (dunce, daily order, dog tags, Echo mint) run even
    # when the owner has workout comments switched off. After comments
    # so a same-workout Echo/claim ping does not double with the comment.
    try:
        from .game import evaluate_workout_game
        arcade_configs = DrillInstructorConfig.objects.filter(
            enabled=True,
            competition__user=workout.user,
            competition__start_date__lte=start_day,
            competition__end_date__gte=start_day,
        ).select_related("competition")
        for arcade_config in arcade_configs:
            try:
                _, created = DrillInstructorMessage.objects.get_or_create(
                    config=arcade_config,
                    workout=workout,
                    kind=DrillInstructorMessage.KIND_ACTIVITY,
                    defaults={"body": ""},
                )
                if created:
                    from custom_user.point_recalc import bump_feed_generation
                    bump_feed_generation([arcade_config.competition_id])
                evaluate_workout_game(workout, arcade_config)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Drill Instructor: game eval failed for workout %s config %s: %s",
                               workout_id, arcade_config.id, exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Drill Instructor: game eval setup failed for workout %s: %s", workout_id, exc)

    return {"workout_id": workout_id, "posted": posted, "competitions": competitions.count()}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def post_test_message(self, config_id, message):
    """Store a one-off test message in the audit log.

    The competition owner triggered this from the Drill Instructor
    settings UI to preview how a message would look; we keep it in the
    audit log so they can re-read it.
    """
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    try:
        config = DrillInstructorConfig.objects.select_related("competition", "persona").get(pk=config_id)
    except DrillInstructorConfig.DoesNotExist:
        return {"error": "Config not found."}

    record = DrillInstructorMessage(
        config=config,
        kind=DrillInstructorMessage.KIND_TEST,
        workout=None,
        body=message,
        posted_at=timezone.now(),
    )
    try:
        record.save()
        return {"config_id": config_id, "id": record.id}
    except Exception as exc:  # noqa: BLE001
        record.success = False
        record.error = str(exc)[:2000]
        try:
            record.save()
        except Exception:  # noqa: BLE001 - pragma: no cover - best-effort audit row
            logger.debug("Drill Instructor: could not resave failed test message", exc_info=True)
        return {"error": str(exc), "config_id": config_id}


# Photo replies run the image-edit probe (up to 90s per candidate model, 3
# candidates) plus the 180s edit itself, so 300s was not enough headroom.
@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=600, soft_time_limit=540)
def post_reply_reaction(self, reply_id):
    """Generate the coach's reaction to a participant's thread reply.

    Triggered by the reply endpoint: the participant's reply is stored
    synchronously, then this task answers it in the persona's voice -
    stored as a ``reaction`` message under the same thread root, with a
    push ping to the replier when the config's push toggle is on.
    Photo replies (the Coach page's photo button) also earn the roast
    remix when an image-edit model is configured.
    """
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    try:
        reply = (
            DrillInstructorMessage.objects
            .select_related("config", "config__competition", "config__persona", "parent", "parent__workout", "workout", "user")
            .get(pk=reply_id)
        )
    except DrillInstructorMessage.DoesNotExist:
        logger.info("Drill Instructor: reply %s no longer exists, skipping reaction.", reply_id)
        return {"skipped": "reply_missing"}

    # Sanity: only ever react to a participant's reply (text or photo)
    # with a thread root.
    if reply.kind not in (DrillInstructorMessage.KIND_REPLY, DrillInstructorMessage.KIND_PHOTO) or reply.user_id is None or reply.parent_id is None:
        return {"skipped": "not_a_reply"}

    config = reply.config
    persona = config.persona
    root = reply.parent
    replier_first_name = reply.user.first_name or reply.user.username or "Athlete"

    # A photo on a workout is not a chat turn. No in-feed coach reply
    # while the remix lands: the original stays the feed answer, the
    # remix is the activity backdrop and the hot-or-not card. If the
    # remix does NOT land right away, the coach still answers in words
    # and the edit is retried in the background - silence is the one
    # outcome a posted picture must never get.
    if reply.kind == DrillInstructorMessage.KIND_PHOTO:
        if root.workout_id and reply.image:
            try:
                from .echoes import process_echoes
                process_echoes(root.workout, config)
            except Exception:
                logger.warning("Photo Echo processing failed for message %s", reply.pk, exc_info=True)
        roast_id = None
        reaction_id = None
        if reply.image:
            roast_model = check_image_edit_capability()
            if roast_model:
                roast_id = _post_photo_roast(
                    config, reply, roast_model, reply.image.path, parent=root,
                )
            if roast_id is None:
                reaction_id = _post_photo_text_reaction(config, reply, parent=root)
                _schedule_roast_retry(reply, root)
        return {"reply_id": reply_id, "reaction_id": reaction_id, "roast_id": roast_id}

    # A photo reply: the coach gets the actual picture when the model can
    # see (checked live - the model could have changed since the post).
    reply_image_path = None
    if reply.image:
        reply_image_path = reply.image.path if check_vision_capability() else None

    # Thread context (everything in the thread before this reply, oldest
    # first, clamped) so the reaction answers the conversation - open
    # questions, earlier banter, who said what - not just the last line.
    history = _thread_history(root, before=reply)

    user_prompt = build_reply_prompt(
        competition_name=config.competition.name,
        coach_message=root.body,
        reply_first_name=replier_first_name,
        reply_body=reply.body,
        thread_history=history,
        reply_has_photo=reply_image_path is not None,
    )

    body, llm_error = generate_message(
        system_prompt=persona.system_prompt,
        user_prompt=user_prompt,
        image_path=reply_image_path,
    )
    if not body and reply_image_path is not None:
        # The probe said vision, the request failed anyway (model swapped,
        # provider-side reject) - retry text-only before the static line.
        body, llm_error = generate_message(
            system_prompt=persona.system_prompt,
            user_prompt=build_reply_prompt(
                competition_name=config.competition.name,
                coach_message=root.body,
                reply_first_name=replier_first_name,
                reply_body=reply.body,
                thread_history=history,
                reply_has_photo=False,
            ),
        )
    if not body:
        body = f"{persona.name}: heard loud and clear, @{replier_first_name}!"

    message = DrillInstructorMessage(
        config=config,
        kind=DrillInstructorMessage.KIND_REACTION,
        parent=root,
        user=None,
        body=body,
        posted_at=timezone.now(),
    )
    try:
        message.save()
        _record_post(config, timezone.now(), error=llm_error or "")
        logger.info("Drill Instructor: stored reaction %s for reply %s", message.id, reply_id)
    except Exception as exc:  # noqa: BLE001 - never block the caller
        _flag_message_failure(message, config, exc, "message")
        return {"error": str(exc), "reply_id": reply_id}

    # Push ping to the replier only - it's a personal reaction, not a
    # group announcement.
    if config.send_push_on_activity:
        _ping_user(
            reply.user,
            title=f"{config.competition.name} - {persona.name}",
            body=body,
            url=_feed_url(message),
            icon=_persona_icon(persona),
            competition_id=config.competition_id,
            log_label="reaction push",
        )

    return {"reply_id": reply_id, "reaction_id": message.id, "roast_id": None}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=600, soft_time_limit=540)
def post_photo_reaction(self, photo_id):
    """Generate the coach's reaction to a participant's photo post.

    Triggered by the photo endpoint: the photo post is stored
    synchronously, then this task reacts to it in the persona's voice -
    stored as a ``reaction`` under the photo thread root, with a push
    ping to the poster when the config's push toggle is on.
    """
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    try:
        photo = (
            DrillInstructorMessage.objects
            .select_related("config", "config__competition", "config__persona", "user", "workout", "parent", "parent__workout")
            .get(pk=photo_id)
        )
    except DrillInstructorMessage.DoesNotExist:
        logger.info("Drill Instructor: photo post %s no longer exists, skipping reaction.", photo_id)
        return {"skipped": "photo_missing"}

    # Sanity: only ever react to a participant's photo thread root.
    if photo.kind != DrillInstructorMessage.KIND_PHOTO or photo.user_id is None or photo.parent_id is not None:
        return {"skipped": "not_a_photo_post"}

    config = photo.config
    persona = config.persona
    author_first_name = photo.user.first_name or photo.user.username or "Athlete"

    # The photo endpoint already gates on vision capability, but the
    # model could have been switched between post and task - re-check.
    can_see = check_vision_capability()
    image_path = photo.image.path if (can_see and photo.image) else None
    roast_model = check_image_edit_capability() if photo.image else None

    user_prompt = build_photo_prompt(
        competition_name=config.competition.name,
        author_first_name=author_first_name,
        caption=photo.body or "",
        can_see_image=image_path is not None,
        roasts_image=roast_model is not None,
    )

    body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=user_prompt, image_path=image_path)
    if not body and image_path is not None:
        # The probe said vision, the request failed anyway (model swapped,
        # provider-side reject) - retry text-only before falling back to
        # the static line.
        body, llm_error = generate_message(
            system_prompt=persona.system_prompt,
            user_prompt=build_photo_prompt(
                competition_name=config.competition.name,
                author_first_name=author_first_name,
                caption=photo.body or "",
                can_see_image=False,
            ),
        )
    if not body:
        body = f"@{author_first_name} drops photo proof - {persona.name} approves. Now back to training!"

    message = DrillInstructorMessage(
        config=config,
        kind=DrillInstructorMessage.KIND_REACTION,
        parent=photo,
        user=None,
        body=body,
        posted_at=timezone.now(),
    )
    try:
        message.save()
        _record_post(config, timezone.now(), error=llm_error or "")
        logger.info("Drill Instructor: stored photo reaction %s for photo post %s", message.id, photo_id)
    except Exception as exc:  # noqa: BLE001 - never block the caller
        _flag_message_failure(message, config, exc, "message")
        return {"error": str(exc), "photo_id": photo_id}

    # Push ping to the poster only - it's a personal reaction, not a
    # group announcement.
    if config.send_push_on_activity:
        _ping_user(
            photo.user,
            title=f"{config.competition.name} - {persona.name}",
            body=body,
            url=_feed_url(photo),
            icon=_persona_icon(persona),
            competition_id=config.competition_id,
            log_label="photo reaction push",
        )

    roast_id = None
    if roast_model and photo.image:
        roast_id = _post_photo_roast(config, photo, roast_model, photo.image.path)
    if roast_id is None and photo.image:
        _schedule_roast_retry(photo, photo)

    return {"photo_id": photo_id, "reaction_id": message.id, "roast_id": roast_id}


def _post_photo_text_reaction(config, photo, parent):
    """The coach's spoken reaction to a picture, hung under ``parent``.

    Used when the remix cannot be delivered right away so the poster is
    never left staring at an unanswered photo. Returns the message id or
    None (the failure is flagged on the config, never raised).
    """
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    persona = config.persona
    author_first_name = photo.user.first_name or photo.user.username or "Athlete"
    image_path = photo.image.path if (photo.image and check_vision_capability()) else None
    history = _thread_history(parent, before=photo) if parent is not None and parent.pk != photo.pk else None
    photo_prompt_kwargs = dict(
        competition_name=config.competition.name,
        author_first_name=author_first_name,
        caption=photo.body or "",
        thread_history=history,
    )
    body, llm_error = generate_message(
        system_prompt=persona.system_prompt,
        user_prompt=build_photo_prompt(can_see_image=image_path is not None, **photo_prompt_kwargs),
        image_path=image_path,
    )
    if not body and image_path is not None:
        body, llm_error = generate_message(
            system_prompt=persona.system_prompt,
            user_prompt=build_photo_prompt(can_see_image=False, **photo_prompt_kwargs),
        )
    if not body:
        body = f"@{author_first_name} drops photo proof - {persona.name} approves. Now back to training!"

    message = DrillInstructorMessage(
        config=config,
        kind=DrillInstructorMessage.KIND_REACTION,
        parent=parent,
        user=None,
        body=body,
        posted_at=timezone.now(),
    )
    try:
        message.save()
        _record_post(config, timezone.now())
        logger.info("Drill Instructor: stored photo text reaction %s for photo %s", message.id, photo.id)
    except Exception as exc:  # noqa: BLE001 - never block the caller
        _flag_message_failure(message, config, exc, "message")
        return None
    if config.send_push_on_activity:
        _ping_user(
            photo.user,
            title=f"{config.competition.name} - {persona.name}",
            body=body,
            url=_feed_url(photo),
            icon=_persona_icon(persona),
            competition_id=config.competition_id,
            log_label="photo reaction push",
        )
    return message.id


# Retry ladder for the remix: 1 min, 4 min, 15 min after the miss. Long
# enough for a provider hiccup or a busy image endpoint to clear, short
# enough that the picture is still "today's" when the roast lands.
ROAST_RETRY_DELAYS = (60, 240, 900)


def _schedule_roast_retry(photo, parent, attempt=1):
    """Queue the next remix attempt; best-effort (a broker outage must not
    fail the reaction that already landed)."""
    if attempt > len(ROAST_RETRY_DELAYS):
        return False
    try:
        retry_photo_roast.apply_async(
            args=(photo.id, parent.id, attempt),
            countdown=ROAST_RETRY_DELAYS[attempt - 1],
        )
        return True
    except Exception:  # noqa: BLE001
        logger.warning("Drill Instructor: could not queue roast retry for photo %s", photo.id, exc_info=True)
        return False


@app.task(bind=True, max_retries=0, time_limit=600, soft_time_limit=540)
def retry_photo_roast(self, photo_id, parent_id, attempt=1):
    """Deliver the remix the reaction task could not.

    Re-probes the edit model ignoring a cached "no" (the usual reason the
    first attempt was skipped), edits, and posts the roast under the
    thread root. Gives up only after ``ROAST_RETRY_DELAYS`` is exhausted
    or once a roast for this photo already exists.
    """
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    try:
        photo = (
            DrillInstructorMessage.objects
            .select_related("config", "config__competition", "config__persona", "user", "workout", "parent", "parent__workout")
            .get(pk=photo_id, kind=DrillInstructorMessage.KIND_PHOTO)
        )
        parent = DrillInstructorMessage.objects.select_related("workout").get(pk=parent_id)
    except DrillInstructorMessage.DoesNotExist:
        return {"skipped": "photo_missing", "photo_id": photo_id}
    if not photo.image:
        return {"skipped": "no_image", "photo_id": photo_id}
    already = DrillInstructorMessage.objects.filter(
        parent=parent, kind=DrillInstructorMessage.KIND_REACTION, user=None,
        posted_at__gte=photo.posted_at,
    ).exclude(image="").exists()
    if already:
        return {"skipped": "roast_exists", "photo_id": photo_id}

    config = photo.config
    if not config.enabled:
        return {"skipped": "coach_benched", "photo_id": photo_id}
    roast_model = check_image_edit_capability(force=True)
    roast_id = None
    if roast_model:
        roast_id = _post_photo_roast(config, photo, roast_model, photo.image.path, parent=parent)
    else:
        config.last_error = "photo roast skipped: no image-edit model available"
        config.save(update_fields=["last_error", "updated_at"])
    if roast_id is None:
        rescheduled = _schedule_roast_retry(photo, parent, attempt + 1)
        if not rescheduled:
            logger.warning("Drill Instructor: giving up on the roast for photo %s after %s attempts", photo_id, attempt)
        return {"photo_id": photo_id, "roast_id": None, "attempt": attempt, "rescheduled": rescheduled}
    return {"photo_id": photo_id, "roast_id": roast_id, "attempt": attempt}


def _workout_answered_to(photo, parent=None):
    """The workout this photo is answering, if any.

    A Coach-page photo is a reply to the latest coach message; when that
    message is a workout comment, its ``workout`` is the one whose stats
    belong on the remixed picture. A thread-root photo has no workout.
    """
    for candidate in (photo, parent, getattr(photo, "parent", None)):
        if candidate is None:
            continue
        workout = getattr(candidate, "workout", None)
        if workout is not None:
            return workout
    return None


def _persona_portrait_path(persona):
    """Filesystem path of the persona's uploaded profile picture, or None."""
    picture = getattr(persona, "profile_picture", None)
    if not picture:
        return None
    try:
        path = picture.path
    except (ValueError, NotImplementedError):
        return None
    return path if path and os.path.isfile(path) else None


def _persona_body_picture_paths(persona):
    """Filesystem paths of the persona's full-body reference photos."""
    paths = []
    for slot in (1, 2, 3):
        picture = getattr(persona, f"body_picture_{slot}", None)
        if not picture:
            continue
        try:
            path = picture.path
        except (ValueError, NotImplementedError):
            continue
        if path and os.path.isfile(path):
            paths.append(path)
    return paths


def _coach_appearance(persona):
    """The coach's canonical full-body look, invented once per persona.

    Cached forever (30d rolling): the whole point is that every roast of
    this coach puts the SAME body under the locked face. Only successes
    are cached - a provider hiccup just means the next roast retries.
    """
    from django.core.cache import cache

    cache_key = f"drill-coach-appearance:{persona.id}"
    cached = cache.get(cache_key)
    if cached:
        return cached
    text = invent_coach_appearance(
        persona_name=persona.name,
        persona_description=persona.description or "",
        persona_tagline=persona.tagline or "",
        persona_avatar=persona.avatar or "",
    )
    if text:
        cache.set(cache_key, text, 60 * 60 * 24 * 30)
    return text


def _draw_roast_treatment(config):
    """Pick this roast's treatment, avoiding what the group just saw.

    Repetition is what makes the roast feel stale, so the last few
    look/twist/prop keys per challenge are remembered (best-effort
    cache - eviction just means a possible repeat, never an error).
    """
    from django.core.cache import cache

    cache_key = f"drill-roast-treatments:{config.id}"
    recent = list(cache.get(cache_key) or [])
    treatment = draw_roast_treatment(avoid=recent)
    used = [treatment["look"], treatment["stat_prop"]]
    if treatment["twist"] != "none":
        used.append(treatment["twist"])
    cache.set(cache_key, (recent + used)[-9:], 60 * 60 * 24 * 30)
    return treatment


def _post_photo_roast(config, photo, roast_model, image_path, parent=None):
    """The entertainment payload: edit the posted photo into a persona-
    styled roast (coach world, coach face, stats; surprise look) and
    post it as a second coach reaction.

    Strictly best-effort - image generation is slow and costs money per
    call, so a failure (quota, safety filter, provider outage) degrades
    to "no roast" with the reason visible in the config's last_error; the
    text reaction above is never at risk.

    ``parent`` defaults to the photo itself (thread-root posts). Photo
    REPLIES pass the thread root instead - threads only render direct
    children of the root, so parenting the roast to the reply would hide
    it from the thread (it would still show in the hot-or-not box).
    """
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    persona = config.persona
    author_first_name = photo.user.first_name or photo.user.username or "Athlete"
    portrait_path = _persona_portrait_path(persona)
    workout = _workout_answered_to(photo, parent)
    workout_summary = format_workout_summary(workout)[0] if workout is not None else ""
    sport_type = getattr(workout, "sport_type", "") if workout is not None else ""

    # dall-e-2 is single-image only; claiming a face lock without sending
    # the portrait would invent a different coach. Other endpoints take
    # the portrait plus up to 3 full-body reference photos (xAI: 2 total
    # extras) - the portrait wins the slots, body photos fill the rest.
    lock_portrait = bool(portrait_path) and roast_model != "dall-e-2"
    reference_cap = 0 if roast_model == "dall-e-2" else max_roast_reference_images()
    body_slots = max(0, reference_cap - (1 if lock_portrait else 0))
    body_paths = _persona_body_picture_paths(persona)[:body_slots]
    reference_paths = ([portrait_path] if lock_portrait else []) + body_paths
    # Real body photos beat the invented body - skip the invention call.
    appearance = None if body_paths else _coach_appearance(persona)
    treatment = _draw_roast_treatment(config)
    # The surprise budget: when a twist is on, ask the chat model to
    # invent a one-off instead of re-dealing from the curated list. Any
    # failure quietly falls back to the list twist already drawn.
    custom_twist = None
    if treatment["twist"] != "none":
        custom_twist = invent_roast_twist(
            persona_name=persona.name,
            persona_description=persona.description or "",
            persona_tagline=persona.tagline or "",
            sport_type=sport_type,
            workout_summary=workout_summary,
            look=treatment["look"],
        )
    roast_prompt = build_roast_image_prompt(
        persona_name=persona.name,
        persona_description=persona.description or "",
        persona_tagline=persona.tagline or "",
        persona_avatar=persona.avatar or "",
        caption=photo.body or "",
        workout_summary=workout_summary,
        sport_type=sport_type,
        has_coach_portrait=lock_portrait,
        look=treatment["look"],
        camera=treatment["camera"],
        stat_prop=treatment["stat_prop"],
        twist=treatment["twist"],
        custom_twist=custom_twist or "",
        coach_appearance=appearance or "",
        body_reference_count=len(body_paths),
    )
    png_bytes, roast_error = generate_roast_image(
        image_path, roast_prompt, roast_model,
        extra_image_paths=reference_paths or None,
    )
    if not png_bytes:
        config.last_error = f"photo roast skipped: {roast_error}"
        config.save(update_fields=["last_error", "updated_at"])
        logger.info("Drill Instructor: photo roast for %s skipped: %s", photo.id, roast_error)
        return None

    caption, _llm_error = generate_message(
        system_prompt=persona.system_prompt,
        user_prompt=build_roast_caption_prompt(
            competition_name=config.competition.name,
            author_first_name=author_first_name,
            caption=photo.body or "",
        ),
    )
    if not caption:
        caption = f"@{author_first_name} - I made you a poster. You're welcome."

    # The provider's bytes are untrusted: verify they decode as an image
    # and re-encode (strips metadata) before they land in MEDIA_ROOT.
    safe_image = _validated_generated_image(png_bytes, f"roast-{photo.id}.png")
    if safe_image is None:
        config.last_error = "photo roast skipped: provider returned an invalid image"
        config.save(update_fields=["last_error", "updated_at"])
        logger.info("Drill Instructor: photo roast for %s skipped: invalid image bytes", photo.id)
        return None

    roast = DrillInstructorMessage(
        config=config,
        kind=DrillInstructorMessage.KIND_REACTION,
        parent=parent or photo,
        user=None,
        body=caption,
        posted_at=timezone.now(),
    )
    roast.image.save(safe_image.name, safe_image, save=False)
    try:
        roast.save()
        _record_post(config, timezone.now())
        logger.info("Drill Instructor: posted photo roast %s for photo post %s", roast.id, photo.id)
        return roast.id
    except Exception as exc:  # noqa: BLE001 - the roast is nice-to-have
        config.last_error = f"photo roast save failed: {str(exc)[:400]}"
        config.save(update_fields=["last_error", "updated_at"])
        logger.warning("Drill Instructor: roast save failed for photo %s: %s", photo.id, exc)
        return None


def _validated_generated_image(raw_bytes, name):
    """Run image-provider output through the upload validator.

    Returns a re-encoded upload (JPEG, or PNG when the source has alpha)
    or None when the bytes are not a decodable image - callers treat
    that as a failed edit.
    """
    from django.core.files.uploadedfile import SimpleUploadedFile
    from workout_challenge.images import validate_and_reencode_image

    try:
        return validate_and_reencode_image(
            SimpleUploadedFile(name, raw_bytes, content_type="image/png"),
        )
    except Exception:  # noqa: BLE001 - ValidationError or a Pillow failure; either way not an image
        logger.warning("Drill Instructor: generated image %s rejected", name, exc_info=True)
        return None


@app.task(bind=True, max_retries=0, time_limit=600, soft_time_limit=540)
def remix_echo_art(self, echo_id, uploaded_by_id=None):
    """Paint the holder's uploaded photo into Echo-specific trophy art.

    Best-effort: if the image-edit model is missing or refuses the edit,
    the original upload stays. Never raises into the worker loop.
    Skip if the Echo changed hands after the upload was queued.
    """
    LegendEcho = apps.get_model("drill_instructor", "LegendEcho")
    try:
        echo = LegendEcho.objects.select_related(
            "config", "config__persona", "holder_workout",
        ).get(pk=echo_id)
    except LegendEcho.DoesNotExist:
        return {"echo": echo_id, "skipped": "missing"}
    if uploaded_by_id and echo.holder_id != uploaded_by_id:
        logger.info("Echo art remix skipped for %s: holder changed", echo_id)
        return {"echo": echo_id, "skipped": "holder changed"}
    if not echo.image:
        return {"echo": echo_id, "skipped": "no image"}
    try:
        image_path = echo.image.path
    except (ValueError, NotImplementedError):
        return {"echo": echo_id, "skipped": "no path"}
    if not image_path or not os.path.isfile(image_path):
        return {"echo": echo_id, "skipped": "missing file"}

    roast_model = check_image_edit_capability()
    if not roast_model:
        logger.info("Echo art remix skipped for %s: no image-edit model", echo_id)
        return {"echo": echo_id, "skipped": "no image-edit model"}

    persona = echo.config.persona
    portrait_path = _persona_portrait_path(persona)
    from .echoes import echo_sport_label
    unit = "km" if echo.metric == "distance" else "min"
    metric_label = f"{echo.metric_value:g} {unit} {echo_sport_label(echo.sport_type)}"
    if echo.holder_workout_id:
        richer, _ = format_workout_summary(echo.holder_workout)
        if richer:
            metric_label = richer
    lock_portrait = bool(portrait_path) and roast_model != "dall-e-2"
    prompt = build_echo_art_prompt(
        title=echo.title,
        narrative=echo.narrative or "",
        sport_type=echo.sport_type or "",
        metric_label=metric_label,
        power=echo.power,
        persona_name=persona.name if persona else "",
        persona_description=(persona.description or "") if persona else "",
        persona_tagline=(persona.tagline or "") if persona else "",
        persona_avatar=(persona.avatar or "") if persona else "",
        has_coach_portrait=lock_portrait,
    )
    png_bytes, error = generate_roast_image(
        image_path, prompt, roast_model,
        extra_image_paths=[portrait_path] if lock_portrait else None,
    )
    if not png_bytes:
        logger.info("Echo art remix skipped for %s: %s", echo_id, error)
        return {"echo": echo_id, "skipped": error or "edit failed"}
    safe_image = _validated_generated_image(png_bytes, f"echo-{echo.pk}.png")
    if safe_image is None:
        logger.info("Echo art remix skipped for %s: invalid image bytes", echo_id)
        return {"echo": echo_id, "skipped": "invalid image"}
    echo.image.save(safe_image.name, safe_image, save=True)
    logger.info("Echo art remixed for %s", echo_id)
    return {"echo": echo_id, "ok": True}


def _retired_generic_task_result():
    return {
        "date": str(timezone.localdate()), "posted": 0, "skipped": 0,
        "competitions": 0, "reason": "retired",
    }


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def post_inactivity_nudges(self):
    # Preserve the Celery name so already-queued work becomes a safe no-op.
    return _retired_generic_task_result()


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def post_random_pushes(self):
    # Preserve the Celery name so already-queued work becomes a safe no-op.
    return _retired_generic_task_result()


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def post_daily_prompts(self):
    # Preserve the Celery name so already-queued work becomes a safe no-op.
    return _retired_generic_task_result()


def _post_coach_line(config, kind, body, llm_error="", send_push=True, image_field=None):
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    message = DrillInstructorMessage(
        config=config, kind=kind, workout=None, body=body, posted_at=timezone.now(),
    )
    message.save()
    if image_field:
        try:
            from django.core.files.base import ContentFile
            image_field.open("rb")
            try:
                data = image_field.read()
            finally:
                image_field.close()
            raw_name = getattr(image_field, "name", "") or "echo.png"
            base = raw_name.rsplit("/", 1)[-1] or "echo.png"
            message.image.save(f"feed-{config.pk}-{base}", ContentFile(data), save=True)
        except Exception as exc:  # noqa: BLE001 - the line still belongs in the feed
            logger.info("Coach line image skipped: %s", exc)
    _record_post(config, timezone.now(), error=llm_error or "")
    if send_push and config.send_push_on_activity:
        persona = config.persona
        for participant in config.competition.user.all():
            _ping_user(
                participant,
                title=f"{config.competition.name} - {persona.name}",
                body=body,
                url=_feed_url(message),
                icon=_persona_icon(persona),
                competition_id=config.competition_id,
                log_label=f"{kind} push",
            )
    return message


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def post_material_rank_gap_change(self, competition_id, user_id):
    """Post one coach line after a score recap materially changes a rank gap."""
    from competition.stats import (
        _RANK_GAP_CACHE_TTL,
        _rank_gap_changed,
        _rank_gap_state,
        get_competition_rank_summary,
    )
    from .models import DrillInstructorMessage, DrillInstructorConfig

    summary = get_competition_rank_summary(
        competition_id, user_id, track_gap_change=False,
    )
    if summary is None:
        return {"posted": False, "reason": "competition_missing"}

    state_key = f"coach-rank-gap:{competition_id}:{user_id}"
    lock_key = f"coach-rank-gap-lock:{competition_id}:{user_id}"
    if not cache.add(lock_key, True, timeout=300):
        return {"posted": False, "reason": "already_running"}

    try:
        current = _rank_gap_state(summary)
        previous = cache.get(state_key)
        if previous is None:
            cache.set(state_key, current, timeout=_RANK_GAP_CACHE_TTL)
            return {"posted": False, "reason": "baseline"}
        if not _rank_gap_changed(previous, current):
            return {"posted": False, "reason": "not_material"}

        today = timezone.localdate()
        config = (
            DrillInstructorConfig.objects.select_related("persona", "competition")
            .filter(
                competition_id=competition_id,
                enabled=True,
                competition__start_date__lte=today,
                competition__end_date__gte=today,
            )
            .first()
        )
        if config is None:
            # Do not announce old movement if a coach is enabled later.
            cache.set(state_key, current, timeout=_RANK_GAP_CACHE_TTL)
            return {"posted": False, "reason": "coach_unavailable"}

        rival = summary.get("rival")
        places = summary.get("places_to_rival")
        rank = summary.get("my_rank")
        if rival and places is not None:
            unit = "place" if places == 1 else "places"
            body = (
                f"The standings shifted. @{rival['username']} is your closest rival, "
                f"{places} {unit} ahead. Home has your updated next step."
            )
        elif rank is not None:
            body = f"The standings shifted. Your current rank is #{rank}. Home has your updated next step."
        else:
            body = "The standings shifted. Check Home for an updated challenge next step."

        _post_coach_line(
            config,
            DrillInstructorMessage.KIND_GAP,
            body,
            send_push=True,
        )
        cache.set(state_key, current, timeout=_RANK_GAP_CACHE_TTL)
        return {"posted": True, "body": body}
    finally:
        cache.delete(lock_key)


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def immortalize_finished_echoes(self):
    """Immortalize live Echoes whose season has ended (15-min sweep)."""
    if is_task_already_executing("immortalize_finished_echoes"):
        return "Task already executing. Skipping."
    from .echoes import immortalize_finished_echoes as sweep
    return sweep()


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def apply_weekly_persona_votes(self):
    """Monday morning: seat next week's voted coach in every running challenge."""
    if is_task_already_executing("apply_weekly_persona_votes"):
        return "Task already executing. Skipping."

    from .ballot import apply_persona_votes

    Competition = apps.get_model("competition", "Competition")
    today = timezone.localdate()
    competitions = (
        Competition.objects
        .filter(start_date__lte=today, end_date__gte=today, drill_instructor__enabled=True)
        .select_related("drill_instructor", "drill_instructor__persona", "drill_instructor__previous_persona")
        .prefetch_related("user")
    )
    switched = 0
    kept = 0
    for competition in competitions:
        try:
            result = apply_persona_votes(competition.drill_instructor)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Weekly coach vote failed for competition %s: %s", competition.id, exc)
            continue
        if result["switched"]:
            switched += 1
        else:
            kept += 1
    summary = {"date": str(today), "switched": switched, "kept": kept, "competitions": competitions.count()}
    logger.info("Weekly coach vote sweep: %s", summary)
    return summary


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def issue_daily_orders(self):
    """Morning sealed order for every running, coached challenge."""
    if is_task_already_executing("issue_daily_orders"):
        return "Task already executing. Skipping."

    from .game import draw_order_spec
    from .llm_client import generate_message
    Competition = apps.get_model("competition", "Competition")
    DailyOrder = apps.get_model("drill_instructor", "DailyOrder")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    today = timezone.localdate()
    competitions = (
        Competition.objects
        .filter(start_date__lte=today, end_date__gte=today, drill_instructor__enabled=True)
        .select_related("drill_instructor", "drill_instructor__persona")
        .prefetch_related("user")
    )
    issued = 0
    skipped = 0
    failed = 0
    for competition in competitions:
        config = competition.drill_instructor
        if DailyOrder.objects.filter(config=config, date=today).exists():
            skipped += 1
            continue
        participants = list(competition.user.all())
        if not participants:
            skipped += 1
            continue
        kind, spec, brief = draw_order_spec(config, today, participants)
        DailyOrder.objects.create(config=config, date=today, kind=kind, spec=spec, brief=brief)
        persona = config.persona
        prompt = (
            f"Competition: {competition.name}. Situation: you are issuing today's "
            f"SEALED ORDER to the whole group. The order is: \"{brief}\" "
            "Write one short bark (max 220 chars) in your persona's voice that "
            "delivers that order, names nobody who isn't in the brief, and "
            "makes it feel like a mission. Write it now."
        )
        body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=prompt)
        if not body:
            body = f"{persona.name}: ORDER OF THE DAY — {brief}"
        try:
            _post_coach_line(config, DrillInstructorMessage.KIND_ORDER, body, llm_error or "")
            issued += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Drill Instructor: daily order post failed for %s: %s", competition.id, exc)
            # The DailyOrder row exists (the game runs), only the bark is
            # missing - report it as failed, not issued.
            failed += 1
    return {"date": str(today), "issued": issued, "skipped": skipped, "failed": failed}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def close_daily_orders(self):
    """Close today's orders without publicly identifying non-completers.

    ``failed_announced`` is retained as the persisted idempotency marker for
    older rows/clients. It now means the order has been closed; no public
    message or push is generated for individual completion status.
    """
    if is_task_already_executing("close_daily_orders"):
        return "Task already executing. Skipping."

    DailyOrder = apps.get_model("drill_instructor", "DailyOrder")
    today = timezone.localdate()
    orders = DailyOrder.objects.filter(date=today, failed_announced=False)
    closed = orders.update(failed_announced=True)
    return {"date": str(today), "sighed": 0, "closed": closed}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=180)
def assign_dunces(self):
    """Retire public last-place crowning and clear any persisted legacy crowns."""
    if is_task_already_executing("assign_dunces"):
        return "Task already executing. Skipping."

    Config = apps.get_model("drill_instructor", "DrillInstructorConfig")
    today = timezone.localdate()
    cleared = Config.objects.filter(dunce__isnull=False).update(
        dunce=None,
        dunce_since=None,
        updated_at=timezone.now(),
    )
    return {"date": str(today), "crowned": 0, "cleared": cleared}

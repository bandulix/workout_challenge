import datetime
import logging
import os
import random

from django.apps import apps
from django.db import IntegrityError
from django.db.models import Sum
from django.utils import timezone

from workout_challenge.celery import app, is_task_already_executing

from .formatters import format_workout_summary
from .llm_client import build_echo_art_prompt, build_group_push_prompt, build_inactivity_prompt, build_photo_prompt, build_reply_prompt, build_roast_caption_prompt, build_roast_image_prompt, build_workout_prompt, check_image_edit_capability, check_vision_capability, generate_message, generate_roast_image

try:
    from push_notifications.sender import send_push_to_user
except ImportError:  # pragma: no cover - keeps the module importable for tests
    send_push_to_user = None

logger = logging.getLogger(__name__)


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


def _recent_bodies(config, limit=2):
    """The persona's last ``limit`` message bodies for this config.

    Passed into the prompt builders so the instructor can refer back to
    its own recent messages (continuity, callbacks) and avoid repeating
    itself. Test messages are previews, not conversation; failed
    generations never reached the group - both are excluded.
    """
    return list(
        config.messages
        .exclude(kind__in=["test", "reply"])
        .filter(success=True)
        .order_by("-posted_at")
        .values_list("body", flat=True)[:limit]
    )


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
    """Generate a Drill Instructor comment for a workout and store it.

    For every competition this workout belongs to that has an enabled
    Drill Instructor, generate one AI-voiced comment, persist it to
    ``DrillInstructorMessage`` so the competition owner can read it from
    the audit log, and (optionally) send a web push to the athlete.
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

    Competition = apps.get_model("competition", "Competition")
    competitions = Competition.objects.filter(
        start_date__lte=start_dt.date(),
        end_date__gte=start_dt.date(),
        user=workout.user,
        drill_instructor__enabled=True,
        drill_instructor__comment_on_activity=True,
    ).select_related("drill_instructor", "drill_instructor__persona")

    summary, duration_min = format_workout_summary(workout)

    # Arcade rules (dunce, daily order, dog tags) run even when the
    # owner has workout comments switched off.
    try:
        from .game import evaluate_workout_game
        arcade_configs = DrillInstructorConfig.objects.filter(
            enabled=True,
            competition__user=workout.user,
            competition__start_date__lte=start_dt.date(),
            competition__end_date__gte=start_dt.date(),
        ).select_related("competition")
        for arcade_config in arcade_configs:
            try:
                evaluate_workout_game(workout, arcade_config)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Drill Instructor: game eval failed for workout %s config %s: %s",
                               workout_id, arcade_config.id, exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Drill Instructor: game eval setup failed for workout %s: %s", workout_id, exc)

    posted = 0
    for competition in competitions:
        config = competition.drill_instructor
        persona = config.persona

        # Idempotency: one workout comment per competition per workout.
        # Double enqueues (double submit, sync edge cases, redelivery)
        # must never produce a second, identical coach message.
        if DrillInstructorMessage.objects.filter(
            config=config, workout=workout, kind=DrillInstructorMessage.KIND_ACTIVITY
        ).exists():
            logger.info("Drill Instructor: workout %s already commented in competition %s, skipping.", workout_id, competition.id)
            continue

        rank, total_participants, my_total, leader_total, target_user = _user_rank(workout, competition)
        user_prompt = build_workout_prompt(
            user_first_name=workout.user.first_name or workout.user.username or "Athlete",
            username=workout.user.username or "",
            sport_type=workout.sport_type,
            duration_minutes=duration_min or 0,
            distance_km=float(workout.distance) if workout.distance is not None else None,
            kcal=float(workout.kcal) if workout.kcal is not None else None,
            intensity=workout.intensity_category or 0,
            competition_name=competition.name,
            points_capped=None,
            user_rank=rank,
            total_participants=total_participants,
            leader_points=leader_total,
            user_total_points=my_total,
            target_first_name=(target_user.first_name if target_user else None),
            previous_messages=_recent_bodies(config),
            echo_lines=_echo_lines(config),
        )

        body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=user_prompt)
        if not body:
            body = f"{persona.name}: nice work on that {summary or workout.sport_type}!"

        # Store the message in the in-app audit log so the owner can
        # read it back from the Drill Instructor "messages" endpoint.
        message = DrillInstructorMessage(
            config=config,
            kind=DrillInstructorMessage.KIND_ACTIVITY,
            workout=workout,
            body=body,
            posted_at=timezone.now(),
        )
        try:
            message.save()
        except IntegrityError:
            # Lost the check-then-save race against a concurrent task -
            # the other one posted; nothing is actually wrong.
            logger.info("Drill Instructor: duplicate workout comment suppressed for competition %s.", competition.id)
            continue
        except Exception as exc:  # noqa: BLE001 - never block workout saves
            message.success = False
            message.error = str(exc)[:2000]
            try:
                message.save()
            except Exception:  # pragma: no cover
                pass
            config.last_error = str(exc)[:2000]
            config.save(update_fields=["last_error", "updated_at"])
            logger.warning("Drill Instructor: message save failed for competition %s: %s", competition.id, exc)
            continue

        config.last_posted_at = timezone.now()
        config.messages_posted = (config.messages_posted or 0) + 1
        # Surface an LLM outage (message still posted as static
        # fallback); cleared again on the next successful generation.
        config.last_error = llm_error or ""
        config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
        posted += 1
        logger.info("Drill Instructor: stored message %s for competition %s", message.id, competition.id)

        # Optional web push for the athlete.
        if config.send_push_on_activity and send_push_to_user is not None:
            try:
                send_push_to_user(
                    workout.user,
                    title=f"{competition.name} - {persona.name}",
                    body=body,
                    url=f"/coach",
                    icon=_persona_icon(persona),
                    badge="/icon-badge.png",
                    tag=f"drill-{competition.id}",
                )
            except Exception as exc:  # noqa: BLE001 - never block workout saves
                logger.warning("Drill Instructor: push failed for user %s: %s", workout.user_id, exc)

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
        except Exception:  # pragma: no cover
            pass
        return {"error": str(exc), "config_id": config_id}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def post_reply_reaction(self, reply_id):
    """Generate the coach's reaction to a participant's thread reply.

    Triggered by the reply endpoint: the participant's reply is stored
    synchronously, then this task answers it in the persona's voice -
    stored as a ``reaction`` message under the same thread root, with a
    push ping to the replier when the config's push toggle is on.
    Photo replies (the Coach page's photo button) also earn the roast
    remix when an image-edit model is configured.
    """
    DrillInstructorConfig = apps.get_model("drill_instructor", "DrillInstructorConfig")
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

    # A photo on a workout is not a chat turn. No in-feed coach reply:
    # the remix is the activity backdrop and the hot-or-not card.
    if reply.kind == DrillInstructorMessage.KIND_PHOTO:
        roast_id = None
        if reply.image:
            roast_model = check_image_edit_capability()
            if roast_model:
                roast_id = _post_photo_roast(
                    config, reply, roast_model, reply.image.path, parent=root,
                )
        return {"reply_id": reply_id, "reaction_id": None, "roast_id": roast_id}

    # A photo reply: the coach gets the actual picture when the model can
    # see (checked live - the model could have changed since the post).
    reply_image_path = None
    if reply.image:
        reply_image_path = reply.image.path if check_vision_capability() else None

    # Thread context (the few messages before this reply, oldest first)
    # so the reaction can call back to the conversation.
    prior = list(
        root.replies
        .filter(posted_at__lt=reply.posted_at)
        .select_related("user")
        .order_by("-posted_at")[:4]
    )
    history = [
        {
            "is_coach": m.user_id is None,
            "author": (m.user.first_name or m.user.username) if m.user_id is not None else None,
            "body": m.body,
        }
        for m in reversed(prior)
    ]

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
        config.last_posted_at = timezone.now()
        config.messages_posted = (config.messages_posted or 0) + 1
        config.last_error = llm_error or ""
        config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
        logger.info("Drill Instructor: stored reaction %s for reply %s", message.id, reply_id)
    except Exception as exc:  # noqa: BLE001 - reaction is nice-to-have
        message.success = False
        message.error = str(exc)[:2000]
        try:
            message.save()
        except Exception:  # pragma: no cover
            pass
        config.last_error = str(exc)[:2000]
        config.save(update_fields=["last_error", "updated_at"])
        logger.warning("Drill Instructor: reaction save failed for reply %s: %s", reply_id, exc)
        return {"error": str(exc), "reply_id": reply_id}

    # Push ping to the replier only - it's a personal reaction, not a
    # group announcement.
    if config.send_push_on_activity and send_push_to_user is not None:
        try:
            send_push_to_user(
                reply.user,
                title=f"{config.competition.name} - {persona.name}",
                body=body,
                url=f"/competition/{config.competition_id}",
                icon=_persona_icon(persona),
                badge="/icon-badge.png",
                tag=f"drill-reply-{reply.id}",
            )
        except Exception as exc:  # noqa: BLE001 - never block the reaction
            logger.warning("Drill Instructor: reaction push failed for user %s: %s", reply.user_id, exc)

    return {"reply_id": reply_id, "reaction_id": message.id, "roast_id": None}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
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
        config.last_posted_at = timezone.now()
        config.messages_posted = (config.messages_posted or 0) + 1
        config.last_error = llm_error or ""
        config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
        logger.info("Drill Instructor: stored photo reaction %s for photo post %s", message.id, photo_id)
    except Exception as exc:  # noqa: BLE001 - reaction is nice-to-have
        message.success = False
        message.error = str(exc)[:2000]
        try:
            message.save()
        except Exception:  # pragma: no cover
            pass
        config.last_error = str(exc)[:2000]
        config.save(update_fields=["last_error", "updated_at"])
        logger.warning("Drill Instructor: photo reaction save failed for post %s: %s", photo_id, exc)
        return {"error": str(exc), "photo_id": photo_id}

    # Push ping to the poster only - it's a personal reaction, not a
    # group announcement.
    if config.send_push_on_activity and send_push_to_user is not None:
        try:
            send_push_to_user(
                photo.user,
                title=f"{config.competition.name} - {persona.name}",
                body=body,
                url=f"/competition/{config.competition_id}",
                icon=_persona_icon(persona),
                badge="/icon-badge.png",
                tag=f"drill-photo-{photo.id}",
            )
        except Exception as exc:  # noqa: BLE001 - never block the reaction
            logger.warning("Drill Instructor: photo reaction push failed for user %s: %s", photo.user_id, exc)

    roast_id = None
    if roast_model and photo.image:
        roast_id = _post_photo_roast(config, photo, roast_model, photo.image.path)

    return {"photo_id": photo_id, "reaction_id": message.id, "roast_id": roast_id}


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


def _post_photo_roast(config, photo, roast_model, image_path, parent=None):
    """The entertainment payload: edit the posted photo into a persona-
    styled roast poster and post it as a second coach reaction.

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

    roast_prompt = build_roast_image_prompt(
        persona_name=persona.name,
        persona_description=persona.description or "",
        caption=photo.body or "",
        workout_summary=workout_summary,
        has_coach_portrait=bool(portrait_path),
    )
    png_bytes, roast_error = generate_roast_image(
        image_path, roast_prompt, roast_model,
        extra_image_paths=[portrait_path] if portrait_path else None,
    )
    if not png_bytes and portrait_path:
        # Face-lock extras make some providers 400; retry on the photo alone.
        png_bytes, roast_error = generate_roast_image(
            image_path, roast_prompt, roast_model, extra_image_paths=None,
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

    from django.core.files.base import ContentFile

    roast = DrillInstructorMessage(
        config=config,
        kind=DrillInstructorMessage.KIND_REACTION,
        parent=parent or photo,
        user=None,
        body=caption,
        posted_at=timezone.now(),
    )
    roast.image.save(f"roast-{photo.id}.png", ContentFile(png_bytes), save=False)
    try:
        roast.save()
        workout = _workout_answered_to(photo, parent)
        if workout is not None:
            from .echoes import attach_echo_image
            attach_echo_image(workout, config, roast.image)
        config.last_posted_at = timezone.now()
        config.messages_posted = (config.messages_posted or 0) + 1
        config.save(update_fields=["last_posted_at", "messages_posted", "updated_at"])
        logger.info("Drill Instructor: posted photo roast %s for photo post %s", roast.id, photo.id)
        return roast.id
    except Exception as exc:  # noqa: BLE001 - the roast is nice-to-have
        config.last_error = f"photo roast save failed: {str(exc)[:400]}"
        config.save(update_fields=["last_error", "updated_at"])
        logger.warning("Drill Instructor: roast save failed for photo %s: %s", photo.id, exc)
        return None


@app.task(bind=True, max_retries=0, time_limit=240)
def remix_echo_art(self, echo_id, uploaded_by_id=None):
    """Paint the holder's uploaded photo into Echo-specific trophy art.

    Best-effort: if the image-edit model is missing or refuses the edit,
    the original upload stays. Never raises into the worker loop.
    Skip if the Echo changed hands after the upload was queued.
    """
    from django.core.files.base import ContentFile

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
    unit = "km" if echo.metric == "distance" else "min"
    metric_label = f"{echo.metric_value:g} {unit} {echo.sport_type}"
    if echo.holder_workout_id:
        richer, _ = format_workout_summary(echo.holder_workout)
        if richer:
            metric_label = richer
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
        has_coach_portrait=bool(portrait_path),
    )
    png_bytes, error = generate_roast_image(
        image_path, prompt, roast_model,
        extra_image_paths=[portrait_path] if portrait_path else None,
    )
    if not png_bytes and portrait_path:
        png_bytes, error = generate_roast_image(
            image_path, prompt, roast_model, extra_image_paths=None,
        )
    if not png_bytes:
        logger.info("Echo art remix skipped for %s: %s", echo_id, error)
        return {"echo": echo_id, "skipped": error or "edit failed"}
    echo.image.save(f"echo-{echo.pk}.png", ContentFile(png_bytes), save=True)
    logger.info("Echo art remixed for %s", echo_id)
    return {"echo": echo_id, "ok": True}


def _competition_leader(competition):
    """Return ``(leader_user, leader_points)`` for a competition, or
    ``(None, 0)`` when nobody has scored yet."""
    Points = apps.get_model("competition", "Points")

    top = (
        Points.objects
        .filter(goal__competition=competition)
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
        .order_by("-total")
        .first()
    )
    if not top:
        return None, 0

    CustomUser = apps.get_model("custom_user", "CustomUser")
    leader = CustomUser.objects.filter(pk=top["workout__user"]).first()
    return leader, top["total"] or 0


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def post_inactivity_nudges(self):
    """Post one motivational nudge in every running competition that went
    quiet today.

    Scheduled daily via Celery beat. For every competition that is
    currently running and has an enabled Drill Instructor with
    ``nudge_on_inactivity``:
      * if any participant logged a workout today -> skip
      * if a nudge was already posted today -> skip (idempotent re-runs)
      * otherwise generate one persona-voiced message addressed at the
        whole group, store it in the audit log, and (when the config's
        push toggle is on) push it to every subscribed participant.
    """
    Workout = apps.get_model("workouts", "Workout")
    Competition = apps.get_model("competition", "Competition")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    # Overlap guard: a slow first run must not double-post today's nudges.
    if is_task_already_executing("post_inactivity_nudges"):
        return "Task already executing. Skipping."

    today = timezone.localdate()
    competitions = (
        Competition.objects
        .filter(
            start_date__lte=today,
            end_date__gte=today,
            drill_instructor__enabled=True,
            drill_instructor__nudge_on_inactivity=True,
        )
        .select_related("drill_instructor", "drill_instructor__persona")
        .prefetch_related("user")
    )

    posted = 0
    skipped = 0
    for competition in competitions:
        config = competition.drill_instructor
        persona = config.persona
        participants = list(competition.user.all())
        if not participants:
            skipped += 1
            continue

        # Any workout by any participant today? Then the group is active
        # and no nudge is needed.
        if Workout.objects.filter(user__in=participants, start_datetime__date=today).exists():
            skipped += 1
            continue

        # One nudge per competition per day - re-running the beat task
        # must not spam the feed.
        if config.messages.filter(kind=DrillInstructorMessage.KIND_NUDGE, posted_at__date=today).exists():
            skipped += 1
            continue

        leader, leader_points = _competition_leader(competition)
        user_prompt = build_inactivity_prompt(
            competition_name=competition.name,
            participant_first_names=[(u.first_name or u.username or "Athlete") for u in participants],
            leader_first_name=(leader.first_name or leader.username) if leader else None,
            leader_points=float(leader_points) if leader_points else None,
            days_left=(competition.end_date - today).days,
            previous_messages=_recent_bodies(config),
        )

        body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=user_prompt)
        if not body:
            body = (
                f"{persona.name}: quiet day in {competition.name} - "
                "nobody logged a workout. Who breaks the silence?"
            )

        message = DrillInstructorMessage(
            config=config,
            kind=DrillInstructorMessage.KIND_NUDGE,
            workout=None,
            body=body,
            posted_at=timezone.now(),
        )
        try:
            message.save()
            config.last_posted_at = timezone.now()
            config.messages_posted = (config.messages_posted or 0) + 1
            config.last_error = llm_error or ""
            config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
            posted += 1
            logger.info("Drill Instructor: stored inactivity nudge %s for competition %s", message.id, competition.id)
        except Exception as exc:  # noqa: BLE001 - one bad competition must not kill the sweep
            message.success = False
            message.error = str(exc)[:2000]
            try:
                message.save()
            except Exception:  # pragma: no cover
                pass
            config.last_error = str(exc)[:2000]
            config.save(update_fields=["last_error", "updated_at"])
            logger.warning("Drill Instructor: nudge save failed for competition %s: %s", competition.id, exc)
            continue

        # Optional web push to every participant (the nudge targets the
        # whole group, not a single athlete).
        if config.send_push_on_activity and send_push_to_user is not None:
            for participant in participants:
                try:
                    send_push_to_user(
                        participant,
                        title=f"{competition.name} - {persona.name}",
                        body=body,
                        url=f"/coach",
                        icon=_persona_icon(persona),
                        badge="/icon-badge.png",
                        tag=f"drill-nudge-{competition.id}",
                    )
                except Exception as exc:  # noqa: BLE001 - never block the sweep
                    logger.warning("Drill Instructor: nudge push failed for user %s: %s", participant.id, exc)

    return {"date": str(today), "posted": posted, "skipped": skipped, "competitions": competitions.count()}


# Random group pushes land in waking hours only - nobody wants the
# sergeant yelling at 03:00.
PUSH_WINDOW_START_HOUR = 7
PUSH_WINDOW_END_HOUR = 22
PUSH_MAX_PER_DAY = 2


def _draw_push_plan():
    """Draw today's random push slot(s): always exactly one, plus a 50%
    chance of a second one (kept at least 90 minutes from the first so
    they don't clump). Returns a sorted list of "HH:MM" strings."""
    start = PUSH_WINDOW_START_HOUR * 60
    end = PUSH_WINDOW_END_HOUR * 60
    first = random.randrange(start, end)
    slots = [first]
    if random.random() < 0.5:
        for _ in range(10):
            second = random.randrange(start, end)
            if abs(second - first) >= 90:
                slots.append(second)
                break
    return sorted(f"{m // 60:02d}:{m % 60:02d}" for m in slots)


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def post_random_pushes(self):
    """Post the instructor's random daily pep talk in every running
    competition that has it enabled (``random_push``).

    Scheduled every 30 min via Celery beat. Each competition draws its
    own random slot(s) once per day (stored on the config): always at
    least one, at most two, inside waking hours (07:00-22:00). When a
    drawn slot is due and not yet posted, generate one persona-voiced
    message addressed at the whole group, store it in the audit log, and
    (when the config's push toggle is on) push it to every subscribed
    participant. Re-runs are idempotent: the plan is drawn only once per
    day and already-posted slots are counted from the audit log.
    """
    Workout = apps.get_model("workouts", "Workout")
    Competition = apps.get_model("competition", "Competition")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    # Beat fires every 30 min and LLM calls are slow: without the guard
    # an overlapping second run would double-post the same day's slots.
    if is_task_already_executing("post_random_pushes"):
        return "Task already executing. Skipping."

    now = timezone.localtime()
    today = now.date()
    now_hhmm = f"{now.hour:02d}:{now.minute:02d}"
    competitions = (
        Competition.objects
        .filter(
            start_date__lte=today,
            end_date__gte=today,
            drill_instructor__enabled=True,
            drill_instructor__random_push=True,
        )
        .select_related("drill_instructor", "drill_instructor__persona")
        .prefetch_related("user")
    )

    posted = 0
    skipped = 0
    for competition in competitions:
        config = competition.drill_instructor
        persona = config.persona
        participants = list(competition.user.all())
        if not participants:
            skipped += 1
            continue

        # Draw today's random slot(s) once, then reuse them all day.
        if config.push_plan_date != today:
            config.push_plan = _draw_push_plan()
            config.push_plan_date = today
            config.save(update_fields=["push_plan", "push_plan_date", "updated_at"])
        plan = config.push_plan if isinstance(config.push_plan, list) else []

        # Hard cap + idempotency: what already went out today stays counted.
        posted_today = config.messages.filter(kind=DrillInstructorMessage.KIND_PUSH, posted_at__date=today).count()
        due_slots = [slot for slot in plan if slot <= now_hhmm]
        remaining = min(len(due_slots), PUSH_MAX_PER_DAY) - posted_today
        if remaining <= 0:
            skipped += 1
            continue

        leader, leader_points = _competition_leader(competition)

        for _ in range(remaining):
            # History is rebuilt per message so a same-run second push
            # sees the first one (and won't echo it).
            user_prompt = build_group_push_prompt(
                competition_name=competition.name,
                participant_first_names=[(u.first_name or u.username or "Athlete") for u in participants],
                leader_first_name=(leader.first_name or leader.username) if leader else None,
                leader_points=float(leader_points) if leader_points else None,
                days_left=(competition.end_date - today).days,
                workouts_today=Workout.objects.filter(user__in=participants, start_datetime__date=today).count(),
                previous_messages=_recent_bodies(config),
            )
            body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=user_prompt)
            if not body:
                body = (
                    f"{persona.name}: checking in on {competition.name} - "
                    "the day isn't over yet. Get a workout in!"
                )

            message = DrillInstructorMessage(
                config=config,
                kind=DrillInstructorMessage.KIND_PUSH,
                workout=None,
                body=body,
                posted_at=timezone.now(),
            )
            try:
                message.save()
                config.last_posted_at = timezone.now()
                config.messages_posted = (config.messages_posted or 0) + 1
                config.last_error = llm_error or ""
                config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
                posted += 1
                logger.info("Drill Instructor: stored random push %s for competition %s", message.id, competition.id)
            except Exception as exc:  # noqa: BLE001 - one bad competition must not kill the sweep
                message.success = False
                message.error = str(exc)[:2000]
                try:
                    message.save()
                except Exception:  # pragma: no cover
                    pass
                config.last_error = str(exc)[:2000]
                config.save(update_fields=["last_error", "updated_at"])
                logger.warning("Drill Instructor: random push save failed for competition %s: %s", competition.id, exc)
                break

            # Optional web push to every participant (the pep talk targets
            # the whole group, not a single athlete). The tag carries the
            # date so the two daily pushes don't replace each other.
            if config.send_push_on_activity and send_push_to_user is not None:
                for participant in participants:
                    try:
                        send_push_to_user(
                            participant,
                            title=f"{competition.name} - {persona.name}",
                            body=body,
                            url=f"/coach",
                            icon=_persona_icon(persona),
                            badge="/icon-badge.png",
                            tag=f"drill-push-{competition.id}-{today}",
                        )
                    except Exception as exc:  # noqa: BLE001 - never block the sweep
                        logger.warning("Drill Instructor: random push notification failed for user %s: %s", participant.id, exc)

    return {"date": str(today), "posted": posted, "skipped": skipped, "competitions": competitions.count()}


def _post_coach_line(config, kind, body, llm_error=""):
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")
    message = DrillInstructorMessage(
        config=config, kind=kind, workout=None, body=body, posted_at=timezone.now(),
    )
    message.save()
    config.last_posted_at = timezone.now()
    config.messages_posted = (config.messages_posted or 0) + 1
    config.last_error = llm_error or ""
    config.save(update_fields=["last_posted_at", "messages_posted", "last_error", "updated_at"])
    if config.send_push_on_activity and send_push_to_user is not None:
        persona = config.persona
        for participant in config.competition.user.all():
            try:
                send_push_to_user(
                    participant,
                    title=f"{config.competition.name} - {persona.name}",
                    body=body,
                    url="/coach",
                    icon=_persona_icon(persona),
                    badge="/icon-badge.png",
                    tag=f"drill-{kind}-{config.competition_id}-{timezone.localdate()}",
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Drill Instructor: %s push failed for user %s: %s", kind, participant.id, exc)
    return message


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=120)
def resolve_echo_windows(self):
    """Expire Echo challenges whose clock ran out; immortalize survivors."""
    if is_task_already_executing("resolve_echo_windows"):
        return "Task already executing. Skipping."
    from .echoes import expire_challenges
    return expire_challenges()


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
            issued += 1
    return {"date": str(today), "issued": issued, "skipped": skipped}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=300)
def close_daily_orders(self):
    """Evening sigh at a field that ignored today's order."""
    if is_task_already_executing("close_daily_orders"):
        return "Task already executing. Skipping."

    from .llm_client import generate_message
    DailyOrder = apps.get_model("drill_instructor", "DailyOrder")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    today = timezone.localdate()
    orders = (
        DailyOrder.objects.filter(date=today, failed_announced=False)
        .select_related("config", "config__competition", "config__persona")
        .prefetch_related("completed_by", "config__competition__user")
    )
    sighed = 0
    for order in orders:
        config = order.config
        members = list(config.competition.user.all()) if config.enabled else []
        done_ids = set(order.completed_by.values_list("id", flat=True))
        slackers = [u for u in members if u.id not in done_ids]
        order.failed_announced = True
        order.save(update_fields=["failed_announced"])
        if not config.enabled or not slackers or len(done_ids) == len(members):
            continue
        names = ", ".join(f"@{(u.first_name or u.username)}" for u in slackers[:6])
        persona = config.persona
        prompt = (
            f"Competition: {config.competition.name}. Today's order was: \"{order.brief}\". "
            f"These athletes did NOT complete it: {names}. "
            "Write one short public sigh (max 220 chars) in your persona's voice. "
            "Name the slackers with their @FirstName tokens. Write it now."
        )
        body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=prompt)
        if not body:
            body = f"{persona.name}: {names} — the order still stands and you ignored it."
        try:
            _post_coach_line(config, DrillInstructorMessage.KIND_SIGH, body, llm_error or "")
            sighed += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Drill Instructor: order sigh failed for %s: %s", config.id, exc)
    return {"date": str(today), "sighed": sighed}


@app.task(bind=True, max_retries=2, default_retry_delay=30, time_limit=180)
def assign_dunces(self):
    """Midnight: last on the board wears the megaphone until they log."""
    if is_task_already_executing("assign_dunces"):
        return "Task already executing. Skipping."

    from .game import crown_dunce, pick_last_place
    from .llm_client import generate_message
    Competition = apps.get_model("competition", "Competition")
    DrillInstructorMessage = apps.get_model("drill_instructor", "DrillInstructorMessage")

    today = timezone.localdate()
    competitions = (
        Competition.objects
        .filter(start_date__lte=today, end_date__gte=today, drill_instructor__enabled=True)
        .select_related("drill_instructor", "drill_instructor__persona")
        .prefetch_related("user")
    )
    crowned = 0
    for competition in competitions:
        config = competition.drill_instructor
        last = pick_last_place(competition)
        if last is None:
            continue
        changed = crown_dunce(config, last)
        if not changed:
            continue
        persona = config.persona
        name = last.first_name or last.username or "Athlete"
        prompt = (
            f"Competition: {competition.name}. @{name} is last on the board. "
            "You are hanging the dunce megaphone on them until they log a workout. "
            "Write one short public crowning (max 220 chars) in your persona's voice. Write it now."
        )
        body, llm_error = generate_message(system_prompt=persona.system_prompt, user_prompt=prompt)
        if not body:
            body = f"{persona.name}: @{name} wears the megaphone until they log. Last place is a costume now."
        try:
            _post_coach_line(config, DrillInstructorMessage.KIND_DUNCE, body, llm_error or "")
            crowned += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Drill Instructor: dunce post failed for %s: %s", competition.id, exc)
            crowned += 1
    return {"date": str(today), "crowned": crowned}

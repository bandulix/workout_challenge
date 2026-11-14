"""Coach-edited ski-week pictures.

Three cards, all on the same image-edit path the activity remix uses:

* coronation — the morning after a crown, from avatars or a fresh selfie
* hut — an evening group photo turned into a hut postcard
* split — slope photo beside the evening photo

When the image model is down the original photo is kept and the coach
still leaves a line. A second card of the same kind on the same resort
day is refused. The spoken line never asks anyone to drink more.
"""

import logging

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction

from .skiweek import resort_day as current_resort_day

logger = logging.getLogger(__name__)

DRINK_PHRASES = (
    "drink more", "another round", "sambuca", "one more shot", "get drunk",
    "bottoms up", "have a drink", "hit the bar", "trink mehr", "noch einen",
)

PROMPTS = {
    "coronation": (
        "Night in the mountains. Edit the people into a coronation portrait: "
        "an icicle crown and a slender glass sceptre, ice light and a little "
        "gold, dark alpine sky. Keep every face recognizable. No captions, "
        "no bottles, no extra people. Resort: {resort}."
    ),
    "hut": (
        "Night in the mountains. Edit this group into a cosy alpine hut: "
        "a fireplace, snow at the window, wood walls, and a small carved "
        "sign reading {resort}. Keep the people recognizable. No captions "
        "beyond that sign, no bottles."
    ),
    "split": (
        "One picture, split down the middle by a thin ice-gold line. Left "
        "is the slope photo, right is the evening photo. Dark night-alpine "
        "frame. Keep both scenes recognizable. No captions. Resort: {resort}."
    ),
}

LINES = {
    "en": {
        "coronation": "{names} wear the night crown at {resort}.",
        "hut": "The hut at {resort} is warm. The mountain stays cold.",
        "split": "Slope, then evening. {resort} in two moods.",
    },
    "de": {
        "coronation": "{names} tragen die Nachtkrone in {resort}.",
        "hut": "Die Hütte in {resort} ist warm. Der Berg bleibt kalt.",
        "split": "Piste, dann Abend. {resort} in zwei Stimmungen.",
    },
}


class SkiPhotoError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _line_is_safe(body):
    text = (body or "").lower()
    return bool(text.strip()) and not any(phrase in text for phrase in DRINK_PHRASES)


def fallback_line(kind, *, names, resort, language):
    catalog = LINES.get(language) or LINES["en"]
    template = catalog.get(kind) or LINES["en"][kind]
    return template.format(names=names or "The crew", resort=resort or "the mountain")


def _names(users):
    labels = []
    for user in users:
        labels.append(user.first_name or user.username or "Athlete")
    if not labels:
        return "The crew"
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} and {labels[1]}"
    return ", ".join(labels[:-1]) + f" and {labels[-1]}"


def _render(kind, paths, resort, editor):
    prompt = PROMPTS[kind].format(resort=resort or "the Alps")
    if editor is not None:
        return editor(kind, paths, prompt)
    from drill_instructor.llm_client import check_image_edit_capability, generate_roast_image
    model = check_image_edit_capability()
    if not model or not paths:
        return None
    data, _error = generate_roast_image(paths[0], prompt, model, extra_image_paths=paths[1:])
    return data


def _speak(kind, *, names, resort, language, persona, writer):
    if writer is not None:
        text = writer(kind, names, resort, language)
    else:
        text = _llm_line(kind, names=names, resort=resort, language=language, persona=persona)
    if not _line_is_safe(text):
        text = fallback_line(kind, names=names, resort=resort, language=language)
    return text


def _llm_line(kind, *, names, resort, language, persona):
    if persona is None:
        return None
    from drill_instructor.llm_client import generate_message
    prompt = (
        f"One short line, in character, about a {kind} photo at {resort}. "
        f"People: {names}. Mention the mountain or the snow, not a list of numbers. "
        "Never suggest drinking more, never mention Sambuca, shots, or the bar. "
        "No hashtags."
    )
    body, _error = generate_message(
        system_prompt=persona.system_prompt, language=language or persona.language,
        user_prompt=prompt, require_athlete_name=False,
    )
    return body


def _save_upload(field, upload):
    field.save(upload.name or "photo.jpg", upload, save=False)


def _post_feed(campaign, card, users):
    """A coach line in the challenge thread, with the picture attached."""
    from drill_instructor.models import DrillInstructorConfig, DrillInstructorMessage
    config = DrillInstructorConfig.objects.filter(competition=campaign.competition).first()
    if config is None:
        return None
    message = DrillInstructorMessage(
        config=config,
        kind=DrillInstructorMessage.KIND_SKIWEEK,
        user=None,
        body=card.body,
        posted_at=card.created_at,
    )
    message.save()
    picture = card.result if card.result else card.source
    if picture:
        picture.open("rb")
        data = picture.read()
        picture.close()
        message.image.save(f"skicard-{card.id}.jpg", ContentFile(data), save=True)
    card.message_id = message.id
    card.save(update_fields=["message_id"])
    return message.id


def create_card(campaign, kind, users, uploads, *, day=None, editor=None, writer=None, post=True):
    """Store one card. ``uploads`` is a list of Django files (1, or 2 for a split).

    ``editor(kind, paths, prompt)`` returns PNG/JPEG bytes or None.
    ``writer`` returns the coach line or None. Both default to the live LLM.
    """
    from .models import SkiPhotoCard

    if kind not in SkiPhotoCard.KINDS:
        raise SkiPhotoError("bad_kind")
    if kind == SkiPhotoCard.KIND_SPLIT and len(uploads) < 2:
        raise SkiPhotoError("need_two")
    if not uploads:
        raise SkiPhotoError("need_photo")
    day = day or current_resort_day(campaign)
    owner = users[0] if users else None
    if kind != SkiPhotoCard.KIND_CORONATION and owner is None:
        raise SkiPhotoError("need_user")

    existing = SkiPhotoCard.objects.filter(campaign=campaign, kind=kind, resort_day=day)
    if kind == SkiPhotoCard.KIND_CORONATION:
        card = existing.first()
        if card is not None and card.refreshed:
            raise SkiPhotoError("already")
    elif existing.filter(user=owner).exists():
        raise SkiPhotoError("already")

    resort = campaign.resort_name or "the mountain"
    persona = None
    language = "en"
    config = getattr(campaign.competition, "drill_instructor", None)
    if config is not None and config.persona_id:
        persona = config.persona
        language = persona.language or "en"

    card = existing.first() if kind == SkiPhotoCard.KIND_CORONATION and existing.exists() else SkiPhotoCard(
        campaign=campaign, user=owner, kind=kind, resort_day=day,
    )
    refreshing = card.pk is not None
    try:
        with transaction.atomic():
            _save_upload(card.source, uploads[0])
            if len(uploads) > 1:
                _save_upload(card.source_b, uploads[1])
            if refreshing:
                card.refreshed = True
            card.save()
            if kind == SkiPhotoCard.KIND_CORONATION:
                card.subjects.set(users)
    except IntegrityError:
        raise SkiPhotoError("already")

    paths = [p for p in (card.source.path, card.source_b.path if card.source_b else None) if p]
    rendered = None
    try:
        rendered = _render(kind, paths, resort, editor)
    except Exception:
        logger.warning("Ski photo render failed", exc_info=True)
        rendered = None
    names = _names(users)
    card.body = _speak(kind, names=names, resort=resort, language=language, persona=persona, writer=writer)
    if rendered:
        card.result.save(f"{kind}-{card.id}.png", ContentFile(rendered), save=False)
        card.fallback = False
    else:
        card.fallback = True
    card.save()
    if post and kind == SkiPhotoCard.KIND_HUT and not card.message_id:
        _post_feed(campaign, card, users)
    return card


def coronate_if_ready(campaign, settlement, *, editor=None, writer=None):
    """Build the morning portrait from avatars when a crown exists and no card does."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    from .models import SkiPhotoCard

    if settlement.winning_count <= 0:
        return None
    if SkiPhotoCard.objects.filter(
        campaign=campaign, kind=SkiPhotoCard.KIND_CORONATION, resort_day=settlement.resort_day,
    ).exists():
        return None
    users = [crown.user for crown in settlement.crowns.select_related("user")]
    uploads = []
    for user in users:
        picture = getattr(user, "profile_picture", None)
        if not picture:
            continue
        try:
            picture.open("rb")
            uploads.append(SimpleUploadedFile(f"{user.id}.jpg", picture.read(), content_type="image/jpeg"))
            picture.close()
        except Exception:
            continue
    if not uploads:
        return None
    return create_card(
        campaign, SkiPhotoCard.KIND_CORONATION, users, uploads,
        day=settlement.resort_day, editor=editor, writer=writer, post=False,
    )


def card_payload(card, competition_id):
    base = f"/api/competition/{competition_id}/skiweek/cards/{card.id}/image/"
    return {
        "id": card.id,
        "kind": card.kind,
        "resort_day": card.resort_day.isoformat(),
        "body": card.body,
        "fallback": card.fallback,
        "image": base + ("?which=source" if card.fallback or not card.result else ""),
        "original": base + "?which=source",
        "subjects": [
            {"id": user.id, "name": user.first_name or user.username}
            for user in card.subjects.all()
        ],
        "user_id": card.user_id,
    }


def cards_payload(campaign, user):
    from .models import SkiPhotoCard
    rows = SkiPhotoCard.objects.filter(campaign=campaign).prefetch_related("subjects").order_by("-created_at")
    coronation = None
    huts = []
    split = None
    for card in rows:
        if card.kind == SkiPhotoCard.KIND_CORONATION and coronation is None:
            coronation = card_payload(card, campaign.competition_id)
        elif card.kind == SkiPhotoCard.KIND_HUT and len(huts) < 6:
            huts.append(card_payload(card, campaign.competition_id))
        elif card.kind == SkiPhotoCard.KIND_SPLIT and card.user_id == getattr(user, "id", None) and split is None:
            split = card_payload(card, campaign.competition_id)
    return {"coronation": coronation, "huts": huts, "split": split}

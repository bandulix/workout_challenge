import re

from django.urls import reverse
from rest_framework import serializers

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona


def _persona_picture_url(persona):
    """URL of the persona's custom profile picture - always the
    authenticated endpoint, never the raw /media/ path (uploaded artwork
    must not be publicly reachable).

    Deliberately a RELATIVE path (no scheme/host): the app can sit
    behind a reverse proxy that rewrites the Host header, so an
    absolute URL built from the request would point at the internal
    host (e.g. ``http://localhost/...``) - unreachable for the browser
    and blocked by CSP ``connect-src 'self'`` anyway. A relative path
    resolves against the page origin, which is always correct.
    """
    if not persona.profile_picture:
        return None
    return reverse("drill-persona-picture", kwargs={"pk": persona.pk})


class DrillInstructorPersonaSerializer(serializers.ModelSerializer):
    """Persona serializer.

    Read: anyone authenticated can list/retrieve (the library is global).
    Write: admin-only (enforced at the view layer) - a user-controlled
    system prompt would be a prompt-injection vector for competitions
    the user doesn't own. For the same reason the ``system_prompt``
    (the voice & style briefing) is only serialized for staff.
    """

    MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024  # 5 MB

    theme_color = serializers.RegexField(
        regex=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
        required=False,
        allow_blank=True,
        error_messages={"invalid": "Use a hex colour like #d7ff3e."},
    )

    # Read path: the authenticated endpoint URL (see _persona_picture_url).
    # Write path: uploads arrive as ``profile_picture_upload`` (multipart)
    # and map onto the model's profile_picture field.
    profile_picture = serializers.SerializerMethodField()
    profile_picture_upload = serializers.ImageField(
        write_only=True, required=False, allow_null=True, source="profile_picture"
    )

    class Meta:
        model = DrillInstructorPersona
        fields = [
            "id",
            "name",
            "description",
            "tagline",
            "avatar",
            "profile_picture",
            "profile_picture_upload",
            "theme_color",
            "system_prompt",
            "is_builtin",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["is_builtin", "created_by", "created_at", "updated_at"]

    # The voice & style briefing is the admin's prompt-engineering
    # know-how and a prompt-injection surface - regular users never see it.
    STAFF_ONLY_FIELDS = ["system_prompt"]

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not (user and (user.is_staff or user.is_superuser)):
            for field in self.STAFF_ONLY_FIELDS:
                rep.pop(field, None)
        return rep

    def get_profile_picture(self, obj):
        return _persona_picture_url(obj)

    def validate_profile_picture_upload(self, value):
        if value is None:
            return value
        from workout_challenge.images import validate_and_reencode_image
        return validate_and_reencode_image(value, max_bytes=self.MAX_PROFILE_PICTURE_BYTES, max_side=512)

    def validate_avatar(self, value):
        # Either a built-in artwork key (letters/digits/dash/underscore -
        # rendered as /personas/<key>.svg) or a single emoji character.
        value = (value or "").strip()
        if not value:
            return value
        if len(value) <= 40 and re.fullmatch(r"[a-z0-9_-]+", value):
            return value
        if len(value) <= 8:  # emoji (may be a surrogate pair / zwj sequence)
            return value
        raise serializers.ValidationError(
            "Avatar must be an artwork key (a-z, 0-9, -, _) or a single emoji."
        )


class DrillInstructorConfigSerializer(serializers.ModelSerializer):
    """Per-competition Drill Instructor configuration.

    Persona + toggles. ``last_posted_at``, ``messages_posted`` and
    ``last_error`` are read-only bookkeeping for the audit log.
    """

    last_posted_at = serializers.DateTimeField(read_only=True)
    messages_posted = serializers.IntegerField(read_only=True)
    last_error = serializers.CharField(read_only=True)
    competition_name = serializers.CharField(source="competition.name", read_only=True)
    # Whether the configured LLM accepts image input (probed + cached in
    # llm_client.check_vision_capability). The photo-post button and the
    # photo endpoint both gate on this - a text-only model means no
    # photo feature at all.
    vision_capable = serializers.SerializerMethodField()
    # Whether an image-EDIT model is reachable (LLM_IMAGE_* or the chat
    # endpoint's image models). Gates the hot-or-not roast box on the
    # Coach page.
    image_edit_capable = serializers.SerializerMethodField()
    mood = serializers.SerializerMethodField()
    daily_order = serializers.SerializerMethodField()
    dunce = serializers.SerializerMethodField()
    my_tags = serializers.SerializerMethodField()

    class Meta:
        model = DrillInstructorConfig
        fields = [
            "id",
            "competition",
            "competition_name",
            "enabled",
            "persona",
            "persona_detail",
            "comment_on_activity",
            "nudge_on_inactivity",
            "random_push",
            "send_push_on_activity",
            "last_posted_at",
            "messages_posted",
            "last_error",
            "vision_capable",
            "image_edit_capable",
            "mood",
            "daily_order",
            "dunce",
            "my_tags",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def _capability_flags(self):
        """(vision, image_edit) for the photo/roast features.

        Cache-only read: the actual probes make real HTTP calls and would
        stall this hot serializer past the client's fetch timeout on a
        cold cache. A miss queues a background probe (throttled); the
        next config refetch (mount or 60s poll) picks up the result.
        """
        from django.core.cache import cache

        from .llm_client import read_cached_capabilities

        vision, edit = read_cached_capabilities()
        if vision is None or edit is None:
            if cache.add("drill-caps-probe-queued", 1, 120):
                from .tasks import probe_llm_capabilities
                probe_llm_capabilities.delay()
        return bool(vision), bool(edit)

    def get_vision_capable(self, obj):
        return self._capability_flags()[0]

    def get_image_edit_capable(self, obj):
        return self._capability_flags()[1]

    def get_mood(self, obj):
        if not obj.pk:
            return None
        from .game import coach_mood
        try:
            return coach_mood(obj)
        except Exception:
            return None

    def get_daily_order(self, obj):
        if not obj.pk:
            return None
        from .game import order_payload
        orders = getattr(obj, "todays_orders", None)
        if orders is None:
            from django.utils import timezone
            orders = list(obj.daily_orders.filter(date=timezone.localdate()).prefetch_related("completed_by"))
        if not orders:
            return None
        request = self.context.get("request")
        return order_payload(orders[0], getattr(request, "user", None))

    def get_dunce(self, obj):
        if not obj.pk:
            return None
        from .game import dunce_payload
        return dunce_payload(obj)

    def get_my_tags(self, obj):
        from .game import tag_payload
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return []
        try:
            return tag_payload(user)
        except Exception:
            return []

    persona_detail = DrillInstructorPersonaSerializer(source="persona", read_only=True)

    def validate(self, attrs):
        enabled = attrs.get("enabled", getattr(self.instance, "enabled", False))
        if not enabled:
            return attrs

        # A persona is the only thing required to enable the instructor.
        persona = attrs.get("persona", getattr(self.instance, "persona", None))
        if not persona:
            raise serializers.ValidationError(
                {"persona": "Required when the Drill Instructor is enabled."}
            )

        return attrs


def _persona_for_message(obj):
    """Persona that was on duty when this message was written.

    New rows snapshot ``persona`` at insert; older rows fall back to
    the config's current persona (the pre-snapshot behaviour).
    """
    return obj.persona or obj.config.persona


def _user_picture_url(user):
    """Profile picture URL for a thread author - the authenticated
    endpoint (never the raw /media/ path), shared helper shape with
    custom_user.serializers.user_picture_url."""
    from custom_user.serializers import user_picture_url
    return user_picture_url(user)


class DrillInstructorReplySerializer(serializers.ModelSerializer):
    """One entry inside a coach-message thread: a participant's reply
    (``is_coach=false``) or the coach's reaction to it (``is_coach=true``,
    rendered with the thread root's persona fields).
    """

    is_coach = serializers.SerializerMethodField()
    author_name = serializers.SerializerMethodField()
    author_profile_picture = serializers.SerializerMethodField()
    # The coach's roasted-photo remix hangs under the photo post as a
    # reaction - same authenticated endpoint as the root's image.
    image = serializers.SerializerMethodField()

    class Meta:
        model = DrillInstructorMessage
        fields = ["id", "kind", "body", "posted_at", "is_coach", "author_name", "author_profile_picture", "image"]
        read_only_fields = fields

    def get_is_coach(self, obj):
        return obj.user_id is None

    def get_image(self, obj):
        if not obj.image:
            return None
        return reverse("drill-message-picture", kwargs={"pk": obj.pk})

    def get_author_name(self, obj):
        if obj.user_id is None:
            return None
        return obj.user.first_name or obj.user.username or None

    def get_author_profile_picture(self, obj):
        if obj.user_id is None:
            return None
        return _user_picture_url(obj.user)


class DrillInstructorMessageSerializer(serializers.ModelSerializer):
    """Message plus the context the Coach UI needs to render a rich feed.

    Everything is denormalised into one payload so the mobile feed doesn't
    have to fan out into N extra queries per bubble. Thread replies are
    nested oldest-first so the conversation reads top to bottom.

    Photo posts (kind=photo) are participant-authored thread roots: they
    carry the image URL (authenticated endpoint, like profile pictures)
    plus the author's name/picture for the bubble header.
    """

    competition_id = serializers.IntegerField(source="config.competition_id", read_only=True)
    competition_name = serializers.CharField(source="config.competition.name", read_only=True)
    persona_name = serializers.SerializerMethodField()
    persona_tagline = serializers.SerializerMethodField()
    persona_avatar = serializers.SerializerMethodField()
    persona_profile_picture = serializers.SerializerMethodField()
    persona_theme_color = serializers.SerializerMethodField()
    athlete_name = serializers.SerializerMethodField()
    workout_user_id = serializers.SerializerMethodField()
    workout_summary = serializers.SerializerMethodField()
    replies = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    author_name = serializers.SerializerMethodField()
    author_profile_picture = serializers.SerializerMethodField()

    class Meta:
        model = DrillInstructorMessage
        fields = [
            "id",
            "config",
            "kind",
            "workout",
            "body",
            "posted_at",
            "success",
            "error",
            "competition_id",
            "competition_name",
            "persona_name",
            "persona_tagline",
            "persona_avatar",
            "persona_profile_picture",
            "persona_theme_color",
            "athlete_name",
            "workout_user_id",
            "workout_summary",
            "replies",
            "image",
            "author_name",
            "author_profile_picture",
        ]
        read_only_fields = fields

    def get_replies(self, obj):
        if obj.parent_id is not None:
            return []  # replies themselves are never listed standalone
        # Uses the view's ordered Prefetch cache - no query per root.
        return DrillInstructorReplySerializer(obj.replies.all(), many=True, context=self.context).data

    def get_persona_name(self, obj):
        persona = _persona_for_message(obj)
        return persona.name if persona else None

    def get_persona_tagline(self, obj):
        persona = _persona_for_message(obj)
        return persona.tagline if persona else None

    def get_persona_avatar(self, obj):
        persona = _persona_for_message(obj)
        return persona.avatar if persona else None

    def get_persona_theme_color(self, obj):
        persona = _persona_for_message(obj)
        return persona.theme_color if persona else None

    def get_persona_profile_picture(self, obj):
        persona = _persona_for_message(obj)
        return _persona_picture_url(persona) if persona else None

    def get_image(self, obj):
        """Photo post image - the authenticated endpoint, never the raw
        /media/ path (same privacy model as profile pictures; relative
        URL, see _persona_picture_url)."""
        if not obj.image:
            return None
        return reverse("drill-message-picture", kwargs={"pk": obj.pk})

    def get_author_name(self, obj):
        if obj.user_id is None:
            return None
        return obj.user.first_name or obj.user.username or None

    def get_author_profile_picture(self, obj):
        if obj.user_id is None:
            return None
        return _user_picture_url(obj.user)

    def get_athlete_name(self, obj):
        user = getattr(obj.workout, "user", None)
        if user is None:
            return None
        return user.first_name or user.username or None

    def get_workout_user_id(self, obj):
        return getattr(obj.workout, "user_id", None)

    def get_workout_summary(self, obj):
        workout = obj.workout
        if workout is None:
            return None
        parts = []
        if workout.duration is not None:
            parts.append(f"{round(workout.duration.total_seconds() / 60)} min {workout.sport_type}")
        else:
            parts.append(workout.sport_type)
        if workout.distance is not None and workout.sport_type != "Steps":
            parts.append(f"{float(workout.distance):.2f} km")
        if workout.kcal is not None:
            parts.append(f"{round(float(workout.kcal))} kcal")
        return " · ".join(parts)


class RoastCardSerializer(serializers.ModelSerializer):
    """One roasted photo for the Coach page's hot-or-not swipe box.

    Denormalised like the feed serializer: image URL, the coach's caption
    line, persona + competition context, the roasted athlete's first
    name, and the running tally (plus the caller's own vote).
    """

    image = serializers.SerializerMethodField()
    competition_name = serializers.CharField(source="config.competition.name", read_only=True)
    persona_name = serializers.SerializerMethodField()
    athlete_name = serializers.SerializerMethodField()
    hot_votes = serializers.IntegerField(read_only=True)
    not_votes = serializers.IntegerField(read_only=True)
    my_vote = serializers.SerializerMethodField()

    class Meta:
        model = DrillInstructorMessage
        fields = [
            "id",
            "body",
            "posted_at",
            "image",
            "competition_name",
            "persona_name",
            "athlete_name",
            "hot_votes",
            "not_votes",
            "my_vote",
        ]
        read_only_fields = fields

    def get_image(self, obj):
        if not obj.image:
            return None
        return reverse("drill-message-picture", kwargs={"pk": obj.pk})

    def get_persona_name(self, obj):
        persona = _persona_for_message(obj)
        return persona.name if persona else None

    def get_athlete_name(self, obj):
        # The roast hangs under the photo post; its user is the athlete.
        author = getattr(obj.parent, "user", None)
        if author is None:
            return None
        return author.first_name or author.username or None

    def get_my_vote(self, obj):
        # Uses the view's per-user Prefetch (to_attr) - no query per card.
        votes = getattr(obj, "my_votes", None)
        if votes is None:
            votes = list(obj.photo_votes.filter(user=self.context["request"].user))
        return votes[0].hot if votes else None  # True / False / None

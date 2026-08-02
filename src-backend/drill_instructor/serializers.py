import re

from rest_framework import serializers

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona


class DrillInstructorPersonaSerializer(serializers.ModelSerializer):
    """Persona serializer.

    Read: anyone authenticated can list/retrieve (the library is global).
    Write: any authenticated user can create / edit. Deletion of builtin
    personas is blocked at the view layer.
    """

    theme_color = serializers.RegexField(
        regex=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
        required=False,
        allow_blank=True,
        error_messages={"invalid": "Use a hex colour like #d7ff3e."},
    )

    class Meta:
        model = DrillInstructorPersona
        fields = [
            "id",
            "name",
            "description",
            "tagline",
            "avatar",
            "theme_color",
            "system_prompt",
            "is_builtin",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["is_builtin", "created_by", "created_at", "updated_at"]

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
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

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


class DrillInstructorMessageSerializer(serializers.ModelSerializer):
    """Message plus the context the Coach UI needs to render a rich feed.

    Everything is denormalised into one payload so the mobile feed doesn't
    have to fan out into N extra queries per bubble.
    """

    competition_id = serializers.IntegerField(source="config.competition_id", read_only=True)
    competition_name = serializers.CharField(source="config.competition.name", read_only=True)
    persona_name = serializers.CharField(source="config.persona.name", read_only=True)
    persona_tagline = serializers.CharField(source="config.persona.tagline", read_only=True)
    persona_avatar = serializers.CharField(source="config.persona.avatar", read_only=True)
    persona_theme_color = serializers.CharField(source="config.persona.theme_color", read_only=True)
    athlete_name = serializers.SerializerMethodField()
    workout_summary = serializers.SerializerMethodField()

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
            "persona_theme_color",
            "athlete_name",
            "workout_summary",
        ]
        read_only_fields = fields

    def get_athlete_name(self, obj):
        user = getattr(obj.workout, "user", None)
        if user is None:
            return None
        return user.first_name or user.username or None

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

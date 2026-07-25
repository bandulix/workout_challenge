from rest_framework import serializers

from .models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona


class DrillInstructorPersonaSerializer(serializers.ModelSerializer):
    """Persona serializer.

    Read: anyone authenticated can list/retrieve (the library is global).
    Write: any authenticated user can create / edit. Deletion of builtin
    personas is blocked at the view layer.
    """

    class Meta:
        model = DrillInstructorPersona
        fields = [
            "id",
            "name",
            "description",
            "system_prompt",
            "is_builtin",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["is_builtin", "created_by", "created_at", "updated_at"]


class DrillInstructorConfigSerializer(serializers.ModelSerializer):
    """Per-competition Drill Instructor configuration.

    ``matrix_access_token`` is write-only. GETs return only the masked
    preview via the ``access_token_masked`` field, never the real token.
    To update the token the client must explicitly include a non-empty
    ``matrix_access_token`` value; leaving it blank keeps the stored one.
    """

    access_token_masked = serializers.CharField(read_only=True)
    last_posted_at = serializers.DateTimeField(read_only=True)
    messages_posted = serializers.IntegerField(read_only=True)
    last_error = serializers.CharField(read_only=True)

    class Meta:
        model = DrillInstructorConfig
        fields = [
            "id",
            "competition",
            "enabled",
            "persona",
            "persona_detail",
            "matrix_homeserver",
            "matrix_access_token",
            "access_token_masked",
            "matrix_room_id",
            "matrix_bot_display_name",
            "comment_on_activity",
            "send_push_on_activity",
            "last_posted_at",
            "messages_posted",
            "last_error",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
        extra_kwargs = {
            "matrix_access_token": {"write_only": True, "required": False, "allow_blank": True},
        }

    persona_detail = DrillInstructorPersonaSerializer(source="persona", read_only=True)

    def validate(self, attrs):
        enabled = attrs.get("enabled", getattr(self.instance, "enabled", False))
        if not enabled:
            return attrs

        required = ["persona", "matrix_homeserver", "matrix_room_id"]
        for field_name in required:
            value = attrs.get(field_name, getattr(self.instance, field_name, None))
            if not value:
                raise serializers.ValidationError({field_name: "Required when the Drill Instructor is enabled."})

        # On create we always need a token; on update it's optional and
        # the existing token is preserved when blank.
        token = attrs.get("matrix_access_token", "")
        if self.instance is None and not token:
            raise serializers.ValidationError({"matrix_access_token": "Required when the Drill Instructor is enabled."})

        homeserver = attrs.get("matrix_homeserver", getattr(self.instance, "matrix_homeserver", ""))
        if homeserver and not (homeserver.startswith("http://") or homeserver.startswith("https://")):
            raise serializers.ValidationError({"matrix_homeserver": "Must be a full URL starting with http(s)://"})

        room_id = attrs.get("matrix_room_id", getattr(self.instance, "matrix_room_id", ""))
        if room_id and not room_id.startswith("!"):
            raise serializers.ValidationError({"matrix_room_id": "Matrix room IDs start with '!' (e.g. !abc123:matrix.org)."})

        return attrs


class DrillInstructorMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = DrillInstructorMessage
        fields = ["id", "config", "workout", "matrix_event_id", "body", "posted_at", "success", "error"]
        read_only_fields = fields

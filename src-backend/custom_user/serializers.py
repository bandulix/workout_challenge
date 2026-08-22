from rest_framework import serializers
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.urls import reverse
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes

from .models import CustomUser


def user_picture_url(user):
    """URL of the user's profile picture - always the authenticated
    endpoint, never the raw /media/ path (profile pictures must not be
    publicly reachable).

    Deliberately a RELATIVE path (no scheme/host): the app can sit
    behind a reverse proxy that rewrites the Host header, so an
    absolute URL built from the request would point at the internal
    host (e.g. ``http://localhost/...``) - unreachable for the browser
    and blocked by CSP ``connect-src 'self'`` anyway. A relative path
    resolves against the page origin, which is always correct.
    """
    if not user.profile_picture:
        return None
    return reverse("cutomuser-picture", kwargs={"pk": user.pk})


class CustomUserSerializer(serializers.ModelSerializer):
    my = serializers.SerializerMethodField()

    # Read-only mirror of the model's source resolution - the frontend
    # uses it to show which provider is actually importing, without
    # duplicating the fallback logic.
    activity_source_effective = serializers.SerializerMethodField()

    # Whether the server has an Open Wearables instance configured - the
    # settings UI only offers the Health link section when it does.
    # Computed once per request (cached on the serializer instance).
    health_configured = serializers.SerializerMethodField()

    # Invite token required at registration when REGISTRATION_TOKEN is
    # configured server-side. Write-only; validated in validate().
    invite_token = serializers.CharField(write_only=True, required=False, allow_blank=True)

    # Alternative to the invite token: a valid competition join code
    # (from an invite link) also lets a new user register - possession
    # of the link IS the invitation. Write-only; validated in validate().
    join_code = serializers.CharField(write_only=True, required=False, allow_blank=True)

    MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024  # 5 MB

    # Read path: the authenticated endpoint URL (see user_picture_url).
    # Write path: uploads arrive as ``profile_picture_upload``
    # (multipart) and map onto the model's profile_picture field.
    profile_picture = serializers.SerializerMethodField()
    profile_picture_upload = serializers.ImageField(
        write_only=True, required=False, allow_null=True, source='profile_picture'
    )

    def get_profile_picture(self, obj):
        return user_picture_url(obj)

    def validate_profile_picture_upload(self, value):
        if value is None:
            return value
        from workout_challenge.images import validate_and_reencode_image
        return validate_and_reencode_image(value, max_bytes=self.MAX_PROFILE_PICTURE_BYTES, max_side=512)

    class Meta:
        model = CustomUser
        fields = ['id', 'my', 'email', 'first_name', 'last_name', 'gender', 'username', 'password', 'invite_token', 'join_code', 'profile_picture', 'profile_picture_upload', 'is_verified', 'email_mid_week', 'strava_athlete_id', 'strava_allow_follow', 'strava_last_synced_at', 'garmin_email', 'garmin_last_synced_at', 'health_user_id', 'health_last_synced_at', 'health_configured', 'activity_source', 'activity_source_effective', 'my_competitions', 'my_teams', 'goal_active_days', 'goal_workout_minutes', 'goal_distance', 'scaling_kcal', 'scaling_distance', 'is_staff', 'is_superuser']
        # my_competitions / my_teams are read-only: joining happens
        # exclusively through the dedicated join views (join code +
        # participant checks). Writable M2M fields would be a
        # mass-assignment hole letting anyone join any competition/team.
        read_only_fields = ['is_verified', 'strava_athlete_id', 'strava_last_synced_at', 'garmin_email', 'garmin_last_synced_at', 'is_staff', 'is_superuser', 'my_competitions', 'my_teams']
        extra_kwargs = {
            'password': {'write_only': True},
        }

    def get_my(self, obj):
        user = self.context['request'].user
        return obj.pk == user.pk

    def get_activity_source_effective(self, obj):
        return obj.get_activity_source()

    def get_health_configured(self, obj):
        if getattr(self, "_health_configured_cache", None) is None:
            from site_settings.models import resolve_health_settings
            self._health_configured_cache = resolve_health_settings()["enabled"]
        return self._health_configured_cache

    def validate(self, attrs):
        # Registration invite gate (only active when the server has a
        # REGISTRATION_TOKEN configured). compare_digest to avoid a
        # timing oracle over the token bytes. Only enforced on create -
        # profile PATCHes don't re-ask for the token.
        #
        # A valid competition join code (from an invite link) is accepted
        # as an alternative: being invited to a competition implies an
        # invitation to register. The error message intentionally does not
        # say which of the two was wrong, so the endpoint can't be used to
        # probe for valid join codes.
        required = getattr(settings, "REGISTRATION_TOKEN", "")
        if required and self.instance is None:
            import secrets as _secrets
            provided = (attrs.get("invite_token") or "").strip()
            if not _secrets.compare_digest(provided, required):
                from competition.models import Competition
                join_code = (attrs.get("join_code") or "").strip().upper()
                if not join_code or not Competition.objects.filter(join_code=join_code).exists():
                    raise serializers.ValidationError(
                        {"invite_token": "Invalid invite token or competition join code. Please ask the person who invited you for a valid token or invite link."}
                    )
        attrs.pop("invite_token", None)
        attrs.pop("join_code", None)
        return super().validate(attrs)

    def create(self, validated_data):
        from django.contrib.auth.password_validation import validate_password
        validate_password(validated_data.get('password'))
        user = CustomUser.objects.create_user(
            email=validated_data.get('email'),
            first_name=validated_data.get('first_name'),
            last_name=validated_data.get('last_name', None),
            password=validated_data.get('password'),
            gender=validated_data.get('gender', None),
        )
        return user

    def update(self, instance, validated_data):
        # DRF's default update() would setattr('password', <plaintext>)
        # and store the raw password in the DB. Hash it properly.
        password = validated_data.pop('password', None)
        instance = super().update(instance, validated_data)
        if password:
            from django.contrib.auth.password_validation import validate_password
            validate_password(password, user=instance)
            instance.set_password(password)
        # A changed email must be re-verified.
        if 'email' in validated_data and validated_data['email'] != instance.email:
            instance.is_verified = False
        if password or 'email' in validated_data:
            instance.save()
        return instance

    # Fields only the user themselves may see - hidden when serializing
    # co-participants (PII, PII-adjacent settings, and cross-competition
    # membership rosters).
    PRIVATE_FIELDS = [
        'email', 'last_name', 'gender', 'password',
        'strava_last_synced_at', 'garmin_email', 'garmin_last_synced_at',
        'health_user_id', 'health_last_synced_at', 'health_configured',
        'activity_source', 'activity_source_effective',
        'email_mid_week', 'is_verified', 'is_staff', 'is_superuser',
        'my_competitions', 'my_teams',
        'goal_active_days', 'goal_workout_minutes', 'goal_distance',
        'scaling_kcal', 'scaling_distance',
    ]

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        user = self.context['request'].user

        # Omit 'secret' fields of other users that this user is not allowed to see
        if instance.pk != user.pk:
            for field in self.PRIVATE_FIELDS:
                rep.pop(field, None)

            if not rep['strava_allow_follow']:
                rep.pop('strava_athlete_id', None)

        return rep


    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # If instance exists, it's an update (PUT/PATCH), make fields optional
        if self.instance:
            self.fields['email'].required = False
            self.fields['password'].required = False
            self.fields['first_name'].required = False
            self.fields['last_name'].required = False


class PasswordResetSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def save(self, request):
        # Always behave the same whether or not the address is known -
        # the response is identical so an attacker can't enumerate
        # registered emails by timing or by error codes.
        email = (self.validated_data.get('email') or '').strip()

        # iexact: normalize_email() only lowercases the domain part, so
        # users who registered with a mixed-case local part would
        # otherwise never receive their reset email.
        for user in CustomUser.objects.filter(email__iexact=email):
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_url = f"{settings.MAIN_HOST}/password/reset/{uid}/{token}/"

            # Queued via Celery so the response time is identical for
            # known and unknown addresses (no SMTP-roundtrip timing
            # oracle for user enumeration).
            from .emails.celery_emails import password_reset_email
            password_reset_email.apply_async(args=[user.pk, reset_url])



class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        # Single, uniform error - distinct messages would confirm which
        # user ids / uids are valid (user enumeration).
        try:
            uid = urlsafe_base64_decode(attrs['uid']).decode()
            self.user = CustomUser.objects.get(pk=uid)
        except (CustomUser.DoesNotExist, ValueError, TypeError):
            raise serializers.ValidationError("This reset link is invalid or has expired.")

        if not default_token_generator.check_token(self.user, attrs['token']):
            raise serializers.ValidationError("This reset link is invalid or has expired.")

        from django.contrib.auth.password_validation import validate_password
        validate_password(attrs['new_password'], user=self.user)

        return attrs

    def save(self):
        self.user.set_password(self.validated_data['new_password'])
        self.user.save()
        # A reset usually means "something is wrong" - kill every
        # outstanding refresh token so stolen sessions end here.
        from .views import _blacklist_user_tokens
        _blacklist_user_tokens(self.user)
from rest_framework import serializers
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes

from .models import CustomUser


class CustomUserSerializer(serializers.ModelSerializer):
    my = serializers.SerializerMethodField()

    MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024  # 5 MB

    def validate_profile_picture(self, value):
        if value is None:
            return value
        if value.size > self.MAX_PROFILE_PICTURE_BYTES:
            raise serializers.ValidationError("Profile picture too large (max 5 MB).")
        content_type = getattr(value, "content_type", "") or ""
        if not content_type.startswith("image/"):
            raise serializers.ValidationError("File must be an image.")
        return value

    class Meta:
        model = CustomUser
        fields = ['id', 'my', 'email', 'first_name', 'last_name', 'gender', 'username', 'password', 'profile_picture', 'is_verified', 'email_mid_week', 'strava_athlete_id', 'strava_allow_follow', 'strava_last_synced_at', 'garmin_email', 'garmin_last_synced_at', 'my_competitions', 'my_teams', 'goal_active_days', 'goal_workout_minutes', 'goal_distance', 'scaling_kcal', 'scaling_distance', 'is_staff', 'is_superuser']
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
        'email', 'first_name', 'last_name', 'gender', 'password',
        'strava_last_synced_at', 'garmin_email', 'garmin_last_synced_at',
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
        email = (self.validated_data.get('email') or '').strip().lower()

        for user in CustomUser.objects.filter(email=email):
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
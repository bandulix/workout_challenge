import datetime
import logging
import mimetypes
import requests

logger = logging.getLogger(__name__)
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import BasePermission, SAFE_METHODS, AllowAny
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import BaseThrottle, ScopedRateThrottle
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from celery.exceptions import TimeoutError
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from django.shortcuts import get_object_or_404
from django.conf import settings
from django.core.cache import cache

from .serializers import PasswordResetSerializer, PasswordResetConfirmSerializer
from .models import CustomUser
from .serializers import CustomUserSerializer
from .filters import CustomUserFilter
from .strava import sync_strava
from workout_challenge.images import ProtectedMediaRenderer


def _blacklist_user_tokens(user):
    """Invalidate every outstanding refresh token for ``user``.

    Called on account deletion and on Strava unlink so that even if a
    stolen access token (lifetime 15 minutes by default) is replayed
    immediately after the action, the attacker can't mint a fresh
    access token by presenting the (now blacklisted) refresh token.
    """
    try:
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
        outstanding = list(OutstandingToken.objects.filter(user=user))
        BlacklistedToken.objects.bulk_create(
            [BlacklistedToken(token=token) for token in outstanding],
            ignore_conflicts=True,
        )
    except Exception:
        # The blacklist app may not be migrated yet on a brand-new
        # install. Swallow the error so the caller's primary action
        # (delete / unlink) still succeeds - the short access-token
        # lifetime is the next line of defence.
        pass

class IsOwnerOrReadOnly(BasePermission):
    """ Permission class to only allow admins and owner to edit or delete entry """
    def has_permission(self, request, view):
        # Only authenticated users
        if request.user.is_authenticated:
            return True
        return False

    def has_object_permission(self, request, view, obj):
        # Read requests always allowed
        if request.method in SAFE_METHODS:
            return True  # allow GET, HEAD, OPTIONS (GET is filtered at viweset level to only show allowed entries)
        # Only workout user can edit workout
        if hasattr(obj, 'user') and obj.user == request.user:
            return True
        # Only owner of competition can modify
        elif hasattr(obj, 'owner') and obj.owner == request.user:
            return True
        # Only owner can modify goals and awards
        elif hasattr(obj, 'competition') and hasattr(obj.competition, 'owner') and obj.competition.owner == request.user:
            return True
        # If admin allow all requests
        if bool(request.user and request.user.is_staff):
            return True
        return False


class UserPermissionClass(BasePermission):
    """ Allow unauthenticated users to POST data - i.e. for registration.

    The ``POST`` allowance is throttled by ``REGISTER_THROTTLE`` below
    so a single attacker can't bulk-create accounts. Per the docs, the
    first registered user is auto-promoted to staff/superuser, so an
    open registration endpoint without throttling would let an attacker
    race the legitimate first user and lock them out of the admin
    panel.
    """
    def has_permission(self, request, view):
        # Only create new requsts - i.e. POST
        if request.method in ('POST', 'OPTIONS'):
            return True
        return request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        return obj.pk == request.user.pk


# Throttle scopes used with DRF's ScopedRateThrottle - the view sets
# `throttle_scope` and the rate is looked up from
# REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']:
#   'auth' - token obtain/refresh + password reset (brute force)
#   'join' - competition/team join attempts (join-code guessing)


class RegisterRateThrottle(BaseThrottle):
    """Rate-limit anonymous ``POST /api/user/`` (account creation).

    Backed by the Django cache (Redis in production, LocMem in DEBUG),
    so the limit is shared across gunicorn workers. 20 / hour / IP
    easily accommodates real-world signups (a household or small office
    behind a single NAT can create a few accounts in one sitting)
    while still keeping the
    ``first-registered-user-becomes-admin`` race outside the reach of
    a single attacker. Pure-noise attacks (mass bot account creation
    for spam) need to clear captcha / email verification before they
    get this far, so 20/hr is well below that bar too.
    """
    RATE_LIMIT = 20
    RATE_WINDOW_SECONDS = 60 * 60

    def get_cache_key(self, request, view):
        # X-Forwarded-For is set by nginx in front of the API. Take the
        # LAST entry: $proxy_add_x_forwarded_for appends the real client
        # IP, while leading entries can be attacker-supplied spoofs.
        # Fall back to REMOTE_ADDR if there's no proxy.
        ip = request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[-1].strip() or request.META.get('REMOTE_ADDR', 'unknown')
        return f"register-throttle:{ip}"

    def allow_request(self, request, view):
        if request.method != 'POST':
            return True
        from django.core.cache import cache
        key = self.get_cache_key(request, view)
        count = cache.get(key, 0)
        if count >= self.RATE_LIMIT:
            return False
        # ``incr`` is atomic on the cache backend; fall back to ``set``
        # if the key doesn't exist yet (LocMem/Redis return KeyError).
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, self.RATE_WINDOW_SECONDS)
        return True

    def wait(self):
        return self.RATE_WINDOW_SECONDS


class CustomUserViewSet(viewsets.ModelViewSet):
    #queryset = Competition.objects.all()
    serializer_class = CustomUserSerializer

    filter_backends = [DjangoFilterBackend]
    filterset_class = CustomUserFilter

    permission_classes = [UserPermissionClass]
    throttle_classes = [RegisterRateThrottle]

    def get_queryset(self):
        # return all competitions the user is owner of or a participant of
        #time.sleep(3)  # throttle for testing
        return CustomUser.objects.filter(Q(pk=self.request.user.pk) | Q(my_competitions__in=self.request.user.my_competitions.all())).distinct().prefetch_related("dog_tags").order_by('username', 'id')

    def get_object(self):
        lookup_value = self.kwargs.get(self.lookup_field)

        # Modify filter if I ask for myself instead of the id number
        if str(lookup_value).lower() in ['me', 'my', 'myself', 'i']:
            lookup_value = self.request.user.id

        return get_object_or_404(self.get_queryset(), pk=lookup_value)

    def destroy(self, request, *args, **kwargs):
        # Blacklist the user's refresh tokens before the user row is
        # deleted. After the cascade, OutstandingToken rows go with it
        # so we wouldn't be able to blacklist them afterwards.
        instance = self.get_object()
        _blacklist_user_tokens(instance)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated],
            renderer_classes=[ProtectedMediaRenderer])
    def picture(self, request, pk=None):
        """Serve the user's profile picture - authenticated only.

        Profile pictures must not be publicly reachable: they are never
        served from the public /media/ path. Django checks the JWT and
        the caller's visibility (self or co-participant, via the
        viewset's queryset) and, in production, hands the actual file
        delivery to nginx via X-Accel-Redirect (an internal, non-public
        location). In bare Django dev (DEBUG) the file is streamed.
        """
        user = self.get_object()
        if not user.profile_picture:
            raise Http404("No profile picture.")
        from workout_challenge.images import protected_media_response
        return protected_media_response(user.profile_picture)


class PasswordResetView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth'
    def post(self, request):
        serializer = PasswordResetSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(request=request)
            return Response({"detail": "Password reset e-mail sent."})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth'
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response({"detail": "Password has been reset."})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class StravaStateView(APIView):
    """Return a short-lived signed ``state`` token binding the upcoming
    Strava OAuth flow to this user session (CSRF/login-CSRF protection).

    The frontend embeds it in the Strava authorize URL; Strava echoes it
    back; LinkStravaView verifies the signature and that it names the
    same user before exchanging the code.
    """
    permission_classes = [IsAuthenticated]

    STATE_MAX_AGE_SECONDS = 600

    def get(self, request):
        from django.core.signing import TimestampSigner
        state = TimestampSigner().sign(f"strava-link:{request.user.pk}")
        return Response({"state": state}, status=status.HTTP_200_OK)


class LinkStravaView(APIView):
    """ API post view for users to link with Strava. """
    permission_classes = [IsAuthenticated]

    def post(self, request, code, state=""):
        # Verify the OAuth state token: valid signature, fresh, and
        # minted for *this* user - otherwise an attacker could trick a
        # logged-in victim into linking the attacker's Strava account.
        if not state:
            return Response({"message": "Missing Strava session state. Please start the linking again."},
                            status=status.HTTP_400_BAD_REQUEST)
        from django.core.signing import TimestampSigner, BadSignature, SignatureExpired
        try:
            payload = TimestampSigner().unsign(state, max_age=StravaStateView.STATE_MAX_AGE_SECONDS)
        except (BadSignature, SignatureExpired):
            return Response({"message": "Invalid or expired Strava link session. Please start the linking again."},
                            status=status.HTTP_400_BAD_REQUEST)
        if payload != f"strava-link:{request.user.pk}":
            return Response({"message": "Strava link session mismatch. Please start the linking again."},
                            status=status.HTTP_403_FORBIDDEN)

        user = request.user
        from site_settings.models import resolve_strava_settings
        strava_cfg = resolve_strava_settings()
        client_id = strava_cfg["client_id"]
        client_secret = strava_cfg["client_secret"]

        if not client_id or not client_secret:
            return Response({"message": "Sever configuration error - STRAVA_CLIENT_ID and/or STRAVA_CLIENT_SECRET are not set."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            response = requests.post(
                url='https://www.strava.com/oauth/token',
                data={
                    'client_id': client_id,
                    'client_secret': client_secret,
                    'code': code,
                    'grant_type': 'authorization_code'
                },
                timeout=15,
            )
            response.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            if response.status_code == 400:
                # Strava rejected the auth code (already used, expired,
                # or never issued). Surface that to the user.
                return Response({"message": "Invalid or expired Strava linkage code."}, status=status.HTTP_400_BAD_REQUEST)
            return Response({"message": f"Strava token exchange failed ({response.status_code})."}, status=status.HTTP_502_BAD_GATEWAY)
        except requests.RequestException as exc:
            # Network / DNS / TLS error talking to Strava. Don't leak
            # the exception text - it can include the resolved hostname
            # or proxy details.
            return Response({"message": "Could not reach Strava. Please try again later."}, status=status.HTTP_502_BAD_GATEWAY)

        strava_tokens = response.json()
        new_athlete_id = strava_tokens.get('athlete', {}).get('id')

        # If the Strava athlete is already linked to a *different*
        # account on this server, refuse to overwrite it. Otherwise an
        # attacker who happens to be logged into Strava as victim A
        # could use their OAuth code to attach victim A's Strava to
        # their own workout-challenge account.
        if new_athlete_id is not None:
            existing = CustomUser.objects.filter(strava_athlete_id=new_athlete_id).exclude(pk=user.pk).first()
            if existing is not None:
                return Response(
                    {"message": "This Strava account is already linked to a different Workout Challenge user."},
                    status=status.HTTP_409_CONFLICT,
                )

        # Encrypt the refresh token before it touches the DB - a leaked
        # database dump must not hand out live Strava credentials (same
        # treatment the Garmin tokens already get).
        from .token_crypto import encrypt_token
        refresh_token = strava_tokens.get('refresh_token', None)
        setattr(user, 'strava_refresh_token', encrypt_token(refresh_token) if refresh_token else None)
        setattr(user, 'strava_athlete_id', new_athlete_id)
        # The first linked provider becomes the activity source; linking a
        # second provider never changes it (the user switches it in the
        # personal settings).
        if not user.activity_source:
            user.activity_source = 'strava'
        user.save()

        cache.set(f"strava_access_token_{user.id}", strava_tokens.get('access_token', None), int(strava_tokens.get('expires_in', 21600)) - 60)

        # Only import when Strava is the user's activity source - with
        # Garmin selected, an import would double every activity that
        # exists in both ecosystems.
        if user.get_activity_source() != 'strava':
            return Response({"message": "Successfully linked Strava. Garmin is currently your activity source, so no Strava activities were imported - you can switch the source in the personal settings."}, status=status.HTTP_200_OK)

        try:
            running_task = sync_strava.delay(user__id=user.id, start_datetime=datetime.datetime.now() - datetime.timedelta(days=43))
            try:
                running_task.get(timeout=100)
            except TimeoutError:
                logger.info('Strava sync task still running (%s); returning without waiting', running_task.id)
        except requests.exceptions.HTTPError as err:
            if '401 Client Error: Unauthorized' in str(err):
                return Response({'message': 'Access to activities denied by Strava. Not sufficient permissions to download activities.'}, status=status.HTTP_403_FORBIDDEN)
            else:
                return Response({'message': 'Failed to import Strava activities. Please try again later.'}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception:
            # Any other failure in the sync task (or reaching the worker)
            # must not surface as a 500 HTML page - the frontend expects
            # JSON and would otherwise show a bare "parsing error".
            logger.exception("Strava activity import failed unexpectedly for user %s", user.id)
            return Response({'message': 'Strava was linked, but the workout import failed. Please try the sync again later.'}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({"message": "Successfully linked Strava."}, status=status.HTTP_200_OK)


class UnlinkStravaView(APIView):
    """ API post view for users to unlink Strava. """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        setattr(user, 'strava_refresh_token', None)
        setattr(user, 'strava_athlete_id', None)
        user.save()

        # If Strava was unlinked because of a hijacked account, the
        # attacker shouldn't be able to mint a fresh access token. The
        # Strava token is gone; blacklist ours too.
        _blacklist_user_tokens(user)

        return Response({"message": "Successfully unlinked Strava."}, status=status.HTTP_200_OK)


class ResetStravaView(APIView):
    """Reset the Strava connection to a clean slate.

    The repair path for a broken linkage (e.g. Strava invalidated the
    stored refresh token, so every sync fails): wipes every piece of
    connection state - including the cached access token and the sync
    timestamp, which ``UnlinkStravaView`` leaves behind - so the user
    can link again from scratch. Unlike unlink this is not a security
    action, so the user stays logged in (no token blacklisting).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        user.strava_refresh_token = None
        user.strava_athlete_id = None
        user.strava_last_synced_at = None
        user.save(update_fields=['strava_refresh_token', 'strava_athlete_id', 'strava_last_synced_at'])
        cache.delete(f"strava_access_token_{user.id}")

        return Response({"message": "Strava connection reset. You can now link Strava again from scratch."},
                        status=status.HTTP_200_OK)


class SyncStravaView(APIView):
    """ API get view for users to sync Strava. """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        if user.strava_refresh_token is None or user.strava_refresh_token == '':
            return Response({"message": "Strava is not linked."}, status=status.HTTP_400_BAD_REQUEST)

        if user.get_activity_source() != 'strava':
            return Response({"message": "Garmin is your selected activity source - Strava import is disabled so activities don't get doubled. You can switch the source in the personal settings."}, status=status.HTTP_400_BAD_REQUEST)

        if user.strava_last_synced_at is None or user.strava_last_synced_at == '' or user.strava_last_synced_at < (timezone.now() - datetime.timedelta(minutes=59)):
            sync_strava(user__id=user.id)
            return Response({"message": f"Successfully synced Strava."}, status=status.HTTP_200_OK)

        return Response({"message": "Too many requests! You can only request a Strava sync every 60 minutes."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

class LinkGarminView(APIView):
    """Link the user's Garmin Connect account.

    The password is used once to obtain OAuth tokens and is never
    stored - only the encrypted token blob is kept.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .garmin import (
            GarminAuthError,
            GarminUnavailableError,
            encrypt_tokens,
            login_and_get_tokens,
            sync_garmin,
        )

        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or ""
        if not email or not password:
            return Response({"message": "Garmin email and password are required."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            token_blob = login_and_get_tokens(email, password)
        except GarminAuthError:
            # Never forward upstream exception text - it can echo back the
            # account email or internal details (CodeQL stack-trace-exposure).
            logger.info("Garmin login failed for user %s", request.user.pk, exc_info=True)
            return Response({"message": "Garmin login failed - check your credentials (and approve any MFA prompt in the Garmin Connect app first)."},
                            status=status.HTTP_400_BAD_REQUEST)
        except GarminUnavailableError:
            logger.info("Garmin unavailable during link for user %s", request.user.pk, exc_info=True)
            return Response({"message": "Could not reach Garmin - please try again later."},
                            status=status.HTTP_502_BAD_GATEWAY)

        user = request.user
        user.garmin_email = email
        user.garmin_tokens_enc = encrypt_tokens(token_blob)
        user.garmin_last_synced_at = None
        # The first linked provider becomes the activity source; linking a
        # second provider never changes it (the user switches it in the
        # personal settings).
        if not user.activity_source:
            user.activity_source = 'garmin'
        user.save()

        # Only import when Garmin is the user's activity source - with
        # Strava selected, an import would double every activity that
        # exists in both ecosystems.
        if user.get_activity_source() != 'garmin':
            return Response({"message": "Successfully linked Garmin. Strava is currently your activity source, so no Garmin activities were imported - you can switch the source in the personal settings."},
                            status=status.HTTP_200_OK)

        # Initial import of the last ~6 weeks runs in the background -
        # the Garmin SSO roundtrip is slow enough already.
        try:
            sync_garmin.delay(user__id=user.id, days_back=43)
        except Exception as exc:  # noqa: BLE001 - linkage itself succeeded
            logger.warning("Garmin linked but initial sync could not be queued for user %s: %s", user.id, exc)

        return Response({"message": "Successfully linked Garmin. Your recent activities are being imported in the background."},
                        status=status.HTTP_200_OK)


class UnlinkGarminView(APIView):
    """Unlink Garmin Connect and drop the stored tokens."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        user.garmin_email = None
        user.garmin_tokens_enc = None
        user.garmin_last_synced_at = None
        user.save()
        return Response({"message": "Successfully unlinked Garmin."}, status=status.HTTP_200_OK)


class SyncGarminView(APIView):
    """Manually re-sync recent Garmin activities (throttled to hourly)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .garmin import GarminAuthError, GarminUnavailableError, sync_garmin

        user = request.user
        if not user.garmin_tokens_enc:
            return Response({"message": "Garmin is not linked."}, status=status.HTTP_400_BAD_REQUEST)

        if user.get_activity_source() != 'garmin':
            return Response({"message": "Strava is your selected activity source - Garmin import is disabled so activities don't get doubled. You can switch the source in the personal settings."},
                            status=status.HTTP_400_BAD_REQUEST)

        if user.garmin_last_synced_at and user.garmin_last_synced_at > (timezone.now() - datetime.timedelta(minutes=59)):
            return Response({"message": "Too many requests! You can only request a Garmin sync every 60 minutes."},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)

        try:
            result = sync_garmin(user__id=user.id, days_back=3)
        except GarminAuthError:
            logger.info("Garmin auth error during sync for user %s", user.pk, exc_info=True)
            return Response({"message": "Garmin rejected the stored login - please re-link Garmin Connect."},
                            status=status.HTTP_400_BAD_REQUEST)
        except GarminUnavailableError:
            logger.info("Garmin unavailable during sync for user %s", user.pk, exc_info=True)
            return Response({"message": "Could not reach Garmin - please try again later."},
                            status=status.HTTP_502_BAD_GATEWAY)

        return Response({"message": f"Successfully synced Garmin ({result.get('created', 0)} new activities)."},
                        status=status.HTTP_200_OK)


class LinkHealthView(APIView):
    """Link the user to the Open Wearables instance (Apple/Google Health).

    Creates the OW user on first call and always returns a fresh
    single-use invitation code: the athlete enters host + code in the
    health app, which then pushes Apple Health / Health Connect workouts
    to the instance in the background.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .health import (
            HealthConfigError,
            HealthUnavailableError,
            generate_invitation,
            sync_health,
        )

        user = request.user
        try:
            invitation = generate_invitation(user)
        except HealthConfigError:
            return Response({"message": "The Health connector is not configured on this server (Site Settings -> Health)."},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except HealthUnavailableError:
            logger.info("Open Wearables unreachable during health link for user %s", user.pk, exc_info=True)
            return Response({"message": "Could not reach the health sync server - please try again later."},
                            status=status.HTTP_502_BAD_GATEWAY)

        # The first linked provider becomes the activity source; linking
        # another provider never changes it (switched in the settings).
        if not user.activity_source:
            user.activity_source = 'health'
            user.save(update_fields=['activity_source'])

        # Initial import of the last ~6 weeks in the background - only
        # when Health is the user's activity source (otherwise every
        # activity that also exists in the other ecosystem would double).
        if user.get_activity_source() == 'health':
            try:
                sync_health.delay(user__id=user.id, start_datetime=timezone.now() - datetime.timedelta(days=43))
            except Exception as exc:  # noqa: BLE001 - linkage itself succeeded
                logger.warning("Health linked but initial sync could not be queued for user %s: %s", user.id, exc)

        return Response({
            "message": "Health account linked. Enter the connection code in the health app on your phone.",
            "code": invitation["code"],
            "host": invitation["host"],
            "expires_at": invitation["expires_at"],
        }, status=status.HTTP_200_OK)


class UnlinkHealthView(APIView):
    """Unlink the Open Wearables user (workouts already imported are kept)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        user.health_user_id = None
        user.health_last_synced_at = None
        # Never leave the selector pointing at an unlinked provider.
        if user.activity_source == 'health':
            user.activity_source = None
        user.save()
        return Response({"message": "Successfully unlinked Health."}, status=status.HTTP_200_OK)


class SyncHealthView(APIView):
    """Manually re-sync recent Apple/Google Health workouts (hourly cap)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .health import HealthConfigError, HealthUnavailableError, sync_health

        user = request.user
        if not user.health_user_id:
            return Response({"message": "Health is not linked."}, status=status.HTTP_400_BAD_REQUEST)

        if user.get_activity_source() != 'health':
            return Response({"message": "Another provider is your selected activity source - Health import is disabled so activities don't get doubled. You can switch the source in the personal settings."},
                            status=status.HTTP_400_BAD_REQUEST)

        if user.health_last_synced_at and user.health_last_synced_at > (timezone.now() - datetime.timedelta(minutes=59)):
            return Response({"message": "Too many requests! You can only request a Health sync every 60 minutes."},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)

        try:
            result = sync_health(user__id=user.id)
        except HealthConfigError:
            return Response({"message": "The Health connector is not configured on this server."},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except HealthUnavailableError:
            logger.info("Open Wearables unreachable during health sync for user %s", user.pk, exc_info=True)
            return Response({"message": "Could not reach the health sync server - please try again later."},
                            status=status.HTTP_502_BAD_GATEWAY)

        return Response({"message": f"Successfully synced Health ({result.get('created', 0)} new activities)."},
                        status=status.HTTP_200_OK)

SRC = '''import datetime
import logging
import mimetypes
import requests

logger = logging.getLogger(__name__)
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import BasePermission, SAFE_METHODS, AllowAny
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import BaseThrottle
from .throttles import client_ip, ClientIPScopedThrottle
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

from .serializers import (
    PasswordResetSerializer,
    PasswordResetConfirmSerializer,
    EmailVerifyConfirmSerializer,
)
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
    a single attacker. Signup still sends one confirmation mail to the
    posted address (20/hr/IP); branded welcome / weekly / board mail
    wait until that link is clicked.
    """
    RATE_LIMIT = 20
    RATE_WINDOW_SECONDS = 60 * 60

    def get_cache_key(self, request, view):
        # Honour X-Forwarded-For only when the TCP peer is the loopback
        # nginx in this container. Otherwise a client talking to gunicorn
        # directly can rotate XFF and reset the register bucket.
        # LAST XFF hop: $proxy_add_x_forwarded_for appends $remote_addr,
        # so the trailing entry is the real client; leading ones can be
        # attacker-supplied.
        return f"register-throttle:{client_ip(request)}"

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
        from django.db.models import Count
        from drill_instructor.echoes import LIVE_HOLDER_STATUSES
        return (
            CustomUser.objects.filter(
                Q(pk=self.request.user.pk) | Q(my_competitions__in=self.request.user.my_competitions.all())
            )
            .distinct()
            .prefetch_related("dog_tags")
            .annotate(
                echo_hold_count=Count(
                    "echoes_held",
                    filter=Q(echoes_held__status__in=LIVE_HOLDER_STATUSES),
                    distinct=True,
                )
            )
            .order_by("username", "id")
        )

    def get_object(self):
        lookup_value = self.kwargs.get(self.lookup_field)

        # Modify filter if I ask for myself instead of the id number
        if str(lookup_value).lower() in ['me', 'my', 'myself', 'i']:
            lookup_value = self.request.user.id

        obj = get_object_or_404(self.get_queryset(), pk=lookup_value)
        # GenericAPIView.get_object() runs this; skipping it here used
        # to let any co-participant PATCH/DELETE another athlete in
        # the same challenge (IDOR). Picture() swaps in IsAuthenticated
        # so avatars of teammates still load.
        self.check_object_permissions(self.request, obj)
        return obj

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
        the caller's visibility (self or co-participant) and, in
        production, hands the actual file delivery to nginx via
        X-Accel-Redirect. In DEBUG the file is streamed.
        """
        from workout_challenge.images import empty_picture_response, serve_picture

        lookup = pk
        if str(lookup).lower() in ["me", "my", "myself", "i"]:
            lookup = request.user.id
        user = CustomUser.objects.only("id", "profile_picture").filter(pk=lookup).first()
        if user is None:
            return empty_picture_response()
        if user.pk != request.user.pk:
            from competition.models import Competition
            shared = Competition.objects.filter(
                Q(owner=request.user) | Q(user=request.user),
            ).filter(Q(owner=user) | Q(user=user)).exists()
            if not shared:
                return empty_picture_response()
        size = request.query_params.get("size")
        return serve_picture(user.profile_picture, request=request, size=size)


class PasswordResetView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ClientIPScopedThrottle]
    throttle_scope = 'auth'
    def post(self, request):
        serializer = PasswordResetSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(request=request)
            return Response({"detail": "Password reset e-mail sent."})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ClientIPScopedThrottle]
    throttle_scope = 'auth'
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response({"detail": "Password has been reset."})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class EmailVerifyConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ClientIPScopedThrottle]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = EmailVerifyConfirmSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
'''

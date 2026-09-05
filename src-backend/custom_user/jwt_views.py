"""Cookie-aware JWT obtain / refresh / logout views (issue #19)."""

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from custom_user.jwt_cookies import (
    clear_refresh_cookie,
    get_refresh_from_request,
    set_refresh_cookie,
)
from custom_user.throttles import ClientIPScopedThrottle


class CookieTokenObtainPairView(TokenObtainPairView):
    """Login: set httpOnly refresh cookie; access stays in JSON body."""

    throttle_classes = [ClientIPScopedThrottle]
    throttle_scope = "auth"

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code != 200:
            return response
        refresh = response.data.get("refresh")
        if refresh:
            set_refresh_cookie(response, refresh)
        return response


class CookieTokenRefreshView(TokenRefreshView):
    """Refresh: read cookie (or body for native secure storage)."""

    throttle_classes = [ClientIPScopedThrottle]
    throttle_scope = "auth_refresh"

    def post(self, request, *args, **kwargs):
        refresh = get_refresh_from_request(request)
        if not refresh:
            return Response(
                {"detail": "No refresh token.", "code": "token_not_found"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        serializer = self.get_serializer(data={"refresh": refresh})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, InvalidToken, Exception):
            # Dead / blacklisted / malformed refresh: drop the cookie.
            response = Response(
                {"detail": "Token is invalid or expired", "code": "token_not_valid"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            clear_refresh_cookie(response)
            return response

        data = dict(serializer.validated_data)
        response = Response(data, status=status.HTTP_200_OK)
        new_refresh = data.get("refresh")
        if new_refresh:
            set_refresh_cookie(response, new_refresh)
        else:
            # Rotation disabled: keep the presented refresh in the cookie.
            set_refresh_cookie(response, refresh)
        return response


class CookieTokenLogoutView(APIView):
    """Blacklist the refresh token (cookie or body) and clear the cookie.

    AllowAny so a half-dead session can still clear the browser cookie
    without a valid access JWT. If a valid refresh is presented it is
    blacklisted; otherwise we only clear the cookie.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ClientIPScopedThrottle]
    throttle_scope = "auth_refresh"
    authentication_classes = []

    def post(self, request, *args, **kwargs):
        refresh = get_refresh_from_request(request)
        if refresh:
            try:
                token = RefreshToken(refresh)
                token.blacklist()
            except (TokenError, InvalidToken, AttributeError):
                # Already blacklisted / malformed — still clear cookie.
                pass
        response = Response({"detail": "Logged out."}, status=status.HTTP_200_OK)
        clear_refresh_cookie(response)
        return response

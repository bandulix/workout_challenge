"""
URL configuration for workout_challenge project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from custom_user.jwt_views import (
    CookieTokenObtainPairView,
    CookieTokenRefreshView,
    CookieTokenLogoutView,
)
from rest_framework.routers import DefaultRouter
from competition.views import CompetitionViewSet, TeamViewSet, ActivityGoalViewSet, PointsViewSet, CompetitionStatsQueryView, CompetitionStatsSummaryView, FeedQueryView, JoinCompetitionView, JoinTeamView, CeleryQueryView, PointsFactorsView
from workouts.views import WorkoutViewSet
from custom_user.views import CustomUserViewSet, LinkStravaView, UnlinkStravaView, ResetStravaView, SyncStravaView, StravaStateView, PasswordResetView, PasswordResetConfirmView, EmailVerifyConfirmView, EmailVerifyResendView, LinkGarminView, UnlinkGarminView, SyncGarminView, LinkHealthView, UnlinkHealthView, SyncHealthView
from custom_user.link_https import reject_insecure_link


def _https_required(view_cls):
    """Wrap a CBV so Garmin/Strava link flows refuse cleartext HTTP (except DEBUG)."""
    class Wrapped(view_cls):
        def dispatch(self, request, *args, **kwargs):
            blocked = reject_insecure_link(request)
            if blocked is not None:
                return blocked
            return super().dispatch(request, *args, **kwargs)
    Wrapped.__name__ = view_cls.__name__
    Wrapped.__qualname__ = view_cls.__qualname__
    Wrapped.__module__ = view_cls.__module__
    return Wrapped


SecureStravaStateView = _https_required(StravaStateView)
SecureLinkStravaView = _https_required(LinkStravaView)
SecureLinkGarminView = _https_required(LinkGarminView)


# Token endpoints: httpOnly refresh cookie + throttled obtain/refresh.
# Aliases keep workout_challenge.tests.TokenThrottleSplitTests importing
# the historical Throttled* names.
ThrottledTokenObtainPairView = CookieTokenObtainPairView
ThrottledTokenRefreshView = CookieTokenRefreshView
from drill_instructor.views import (
    DrillInstructorPersonaViewSet,
    DrillInstructorConfigViewSet,
    DrillInstructorMessageViewSet,
    DrillInstructorTestMessageView,
    LegendEchoViewSet,
)
from site_settings.views import SiteSettingsView
from push_notifications.views import (
    PushSubscribeView,
    PushUnsubscribeView,
    PushStatusView,
    PushTestView,
)
from .views import ApkVersionView, ReleaseVersionView

router = DefaultRouter()
router.register(r'competition', CompetitionViewSet, basename='competition')
router.register(r'team', TeamViewSet, basename='teams')
router.register(r'goal', ActivityGoalViewSet, basename='goal')
router.register(r'workout', WorkoutViewSet, basename='workout')
router.register(r'point', PointsViewSet, basename='points')
router.register(r'user', CustomUserViewSet, basename='cutomuser')
router.register(r'drill-instructor/persona', DrillInstructorPersonaViewSet, basename='drill-persona')
router.register(r'drill-instructor/config', DrillInstructorConfigViewSet, basename='drill-config')
router.register(r'drill-instructor/message', DrillInstructorMessageViewSet, basename='drill-message')
router.register(r'drill-instructor/echoes', LegendEchoViewSet, basename='drill-echo')

urlpatterns = [
    path('api/', include([
        path('', include(router.urls)),
        path('stats/<int:competition>/', CompetitionStatsQueryView.as_view(), name='competition-stats'),
        path('stats/<int:competition>/summary/', CompetitionStatsSummaryView.as_view(), name='competition-stats-summary'),
        path('feed/<int:competition>/', FeedQueryView.as_view(), name='competition-feed'),
        path('join/competition/<str:join_code>/', JoinCompetitionView.as_view(), name='join-competition'),
        path('join/team/', JoinTeamView.as_view(), name='join-team'),
        path('strava/state/', SecureStravaStateView.as_view(), name='strava-state'),
        path('strava/link/<str:code>/<path:state>/', SecureLinkStravaView.as_view(), name='strava-link'),
        # Missing state must still hit the view (JSON 400) instead of
        # falling through to a bare 404 HTML page the frontend can't parse.
        path('strava/link/<str:code>/', SecureLinkStravaView.as_view(), name='strava-link-no-state'),
        path('strava/unlink/', UnlinkStravaView.as_view(), name='strava-unlink'),
        path('strava/reset/', ResetStravaView.as_view(), name='strava-reset'),
        path('strava/sync/', SyncStravaView.as_view(), name='strava-sync'),
        path('garmin/link/', SecureLinkGarminView.as_view(), name='garmin-link'),
        path('garmin/unlink/', UnlinkGarminView.as_view(), name='garmin-unlink'),
        path('garmin/sync/', SyncGarminView.as_view(), name='garmin-sync'),
        path('health/link/', LinkHealthView.as_view(), name='health-link'),
        path('health/unlink/', UnlinkHealthView.as_view(), name='health-unlink'),
        path('health/sync/', SyncHealthView.as_view(), name='health-sync'),
        path('celery/tasks/', CeleryQueryView.as_view(), name='celery-task-list'),
        path('celery/tasks/<str:task_id>/', CeleryQueryView.as_view(), name='celery-task-status'),
        path('celery/', CeleryQueryView.as_view(), name='celery-task-run'),
        path('drill-instructor/config/<int:pk>/test/', DrillInstructorTestMessageView.as_view(), name='drill-config-test'),
        path('site-settings/', SiteSettingsView.as_view(), name='site-settings'),
        path('points-factors/', PointsFactorsView.as_view(), name='points-factors'),
        path('push/status/', PushStatusView.as_view(), name='push-status'),
        path('push/subscribe/', PushSubscribeView.as_view(), name='push-subscribe'),
        path('push/unsubscribe/', PushUnsubscribeView.as_view(), name='push-unsubscribe'),
        path('push/test/', PushTestView.as_view(), name='push-test'),
        path('version/', ReleaseVersionView.as_view(), name='release-version'),
        path('apk-version/', ApkVersionView.as_view(), name='apk-version'),
        path('token/', ThrottledTokenObtainPairView.as_view(), name='token-initial'),
        path('token/refresh/', ThrottledTokenRefreshView.as_view(), name='token-refresh'),
        path('token/logout/', CookieTokenLogoutView.as_view(), name='token-logout'),
        path('password-reset/request/', PasswordResetView.as_view(), name='password-reset'),
        path('password-reset/confirm/', PasswordResetConfirmView.as_view(), name='password-reset-confirm'),
        path('email-verify/confirm/', EmailVerifyConfirmView.as_view(), name='email-verify-confirm'),
        path('email-verify/resend/', EmailVerifyResendView.as_view(), name='email-verify-resend'),
    ])),
    path('admin/', admin.site.urls),
]


admin.site.site_header = 'Backend Admin Panel'
admin.site.site_title = 'Workout Challenge Backend'
admin.site.index_title = 'Welcome to the Workout Challenge Backend'

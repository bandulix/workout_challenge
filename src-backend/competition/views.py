import logging

from django.db.models import Q
from django.core.exceptions import PermissionDenied
from rest_framework import viewsets
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework import status
from django.core.cache import cache
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.permissions import BasePermission

from django.db.models import Sum

logger = logging.getLogger(__name__)

from custom_user.permissions import IsCompetitionOwner, IsRelatedCompetitionOwner
from custom_user.models import CustomUser
from custom_user.point_recalc import recalc_points
from .models import Competition, Team, ActivityGoal, Points
from .serializers import CompetitionSerializer, TeamSerializer, ActivityGoalSerializer, PointsSerializer
from .stats import get_competition_stats

from celery import current_app
import json

class CompetitionViewSet(viewsets.ModelViewSet):
    #queryset = Competition.objects.all()
    serializer_class = CompetitionSerializer

    permission_classes = [IsCompetitionOwner]

    def get_queryset(self):
        # return all competitions the user is owner of or a participant of
        #time.sleep(3)  # throttle for testing
        return Competition.objects.filter(Q(owner=self.request.user) | Q(user=self.request.user)).distinct().prefetch_related('user').order_by('-end_date', '-start_date', '-id')

    def perform_create(self, serializer):
        # when creating a new competition, set the owner to the request user
        serializer.save(owner=self.request.user)


class TeamViewSet(viewsets.ModelViewSet):
    #queryset = Team.objects.all()
    serializer_class = TeamSerializer

    permission_classes = [IsRelatedCompetitionOwner]

    def get_queryset(self):
        # return all teams the user is a member of and all teams of competitions the user participates in
        #time.sleep(3)  # throttle for testing
        return Team.objects.filter(Q(user=self.request.user) | Q(competition__user=self.request.user)).distinct().prefetch_related('user').order_by('name')

    def perform_create(self, serializer):

        competition_obj = serializer.validated_data.get('competition')

        # if has_teams is disabled, don't allow creation of teams
        if competition_obj.has_teams is False:
            raise PermissionDenied("Teams are disabled for this competition.")

        # only allow user to create a team if they are a member or owner of the competition
        if not (competition_obj.owner == self.request.user) and not (competition_obj in self.request.user.my_competitions.all()):
            raise PermissionDenied("You are not a participant of the competition you want to create a team for.")

        # organizer-assigns-teams mode: only the owner creates teams
        if competition_obj.organizer_assigns_teams and competition_obj.owner != self.request.user:
            raise PermissionDenied("The organizer assigns teams in this competition.")

        serializer.save()


class ActivityGoalViewSet(viewsets.ModelViewSet):
    #queryset = ActivityGoal.objects.all()
    serializer_class = ActivityGoalSerializer

    permission_classes = [IsRelatedCompetitionOwner]

    def get_queryset(self):
        # return all competition categories the user is owner of or a participant of
        #time.sleep(3)  # throttle for testing
        return ActivityGoal.objects.filter(Q(competition__owner=self.request.user) | Q(competition__user=self.request.user)).distinct().order_by('name')

    def perform_create(self, serializer):
        competition_obj = serializer.validated_data.get('competition')

        # only allow user to create a team if they are a member or owner of the competition
        if competition_obj.owner != self.request.user:
            raise PermissionDenied("You can only create and edit competition goals if you are the owner.")

        serializer.save()


class PointsViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only: Points rows are computed exclusively by the scorer
    (``competition.scorer``) from workouts and goals. Previously this was
    a full ModelViewSet and ``IsOwnerOrReadOnly.has_permission`` allows
    any authenticated user through, while ``create()`` never runs
    object-level permission checks - so any user could POST arbitrary
    ``points_raw``/``points_capped`` values for any goal/workout and
    mint points (or attach forged points to someone else's workout).
    """
    serializer_class = PointsSerializer

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # return all points the user is owner of, a participant of, or of his/her own workouts
        #time.sleep(3)  # throttle for testing
        return Points.objects.filter(Q(goal__competition__owner=self.request.user) | Q(goal__competition__user=self.request.user) | Q(workout__user=self.request.user)).distinct().order_by('-workout__start_datetime', '-workout__duration', '-workout', '-workout__user')


class StatsPermissions(BasePermission):
    def has_permission(self, request, view):
        # Only authenticated users
        if not request.user.is_authenticated:
            return False
        # The competition-membership check MUST live here (not only in
        # has_object_permission): ``CompetitionStatsQueryView.get`` serves
        # cached snapshots, so on a cache hit the view body - and its
        # ``check_object_permissions`` call - is the only line of defence.
        # DRF always runs has_permission before the handler, cache hit
        # or not. Without this, any authenticated user could read the
        # cached stats of a competition they don't participate in.
        return self._is_participant(request, view)

    def _is_participant(self, request, view):
        return Competition.objects.filter(
            Q(pk=view.kwargs.get('competition', 0)) & (Q(owner=request.user) | Q(user=request.user))
        ).exists()

    def has_object_permission(self, request, view, obj):
        return self._is_participant(request, view)


class IsAdmin(BasePermission):
    """
    Custom permission class to allow access only to admin users.
    """
    def has_permission(self, request, view):
        # Check if user is authenticated and is an admin
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class PointsFactorsView(APIView):
    """The effective per-activity-type point multipliers for every sport
    type (site-wide, admin-edited via Site Settings). Any logged-in user
    may read them - the challenge "How points work" view shows them for
    transparency. Not secret: they only describe the public scoring."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from workouts.models import SPORT_TYPES
        from .scorer import get_sport_factors, sport_factor

        factors = get_sport_factors()
        return Response({
            "factors": {key: sport_factor(key, factors) for key, _label in SPORT_TYPES},
        })


class CeleryQueryView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, task_id=None):
        if task_id:
            # Get status of specific task
            try:
                task = current_app.AsyncResult(task_id)
                return Response({
                    'task_id': task.id,
                    'status': task.status,
                    'result': task.result if task.successful() else None,
                    # Failed Celery results are exception objects; str()
                    # leaks paths / broker URLs (CodeQL stack-trace-exposure).
                    'error': "Task failed." if task.failed() else None
                })
            except Exception:
                # Exception text can leak internals (paths, broker URLs) -
                # log it, return a generic message (CodeQL stack-trace-exposure).
                logger.exception("Error retrieving celery task status")
                return Response(
                    {"error": "Error retrieving task status."},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            # List all registered tasks
            try:
                registered_tasks = sorted(self.ALLOWED_TASKS)
                return Response(registered_tasks)
            except Exception:
                logger.exception("Error listing celery tasks")
                return Response(
                    {"error": "Error retrieving tasks."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

    # Staff can only enqueue these operational tasks - not an arbitrary
    # registered name (that used to be "run any celery task with JSON args").
    ALLOWED_TASKS = frozenset({
        "custom_user.strava.daily_strava_sync",
        "custom_user.garmin.daily_garmin_sync",
        "custom_user.health.daily_health_sync",
        "custom_user.point_recalc.recalc_points",
        "drill_instructor.tasks.post_inactivity_nudges",
        "drill_instructor.tasks.post_random_pushes",
        "drill_instructor.tasks.apply_weekly_persona_votes",
        "drill_instructor.tasks.resolve_echo_windows",
        "custom_user.emails.celery_emails.send_all_log_workouts_email",
        "custom_user.emails.celery_emails.send_all_leaderboard_emails",
        "custom_user.emails.celery_emails.send_all_weekly_emails",
        "custom_user.emails.celery_emails.send_all_competition_start_email",
    })

    def post(self, request):
        task = request.query_params.get('task')
        args = request.query_params.get('args', '[]')
        kwargs = request.query_params.get('kwargs', '{}')
        
        if not task:
            return Response(
                {"error": "Task name is required"}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        if task not in self.ALLOWED_TASKS:
            return Response(
                {"error": "This task cannot be started from the API."},
                status=status.HTTP_403_FORBIDDEN,
            )
            
        try:
            # Convert string args and kwargs to Python objects
            args_list = json.loads(args)
            kwargs_dict = json.loads(kwargs)
            
            # Get the task by name and apply it with args and kwargs
            celery_task = current_app.tasks[task]
            result = celery_task.delay(*args_list, **kwargs_dict)
            
            return Response({
                "task_id": result.task_id,
                "status": "Task sent successfully"
            })
            
        except json.JSONDecodeError:
            return Response(
                {"error": "Invalid JSON format in args or kwargs"}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        except KeyError:
            return Response(
                {"error": f"Task '{task}' not found"}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception:
            logger.exception("Error starting celery task %s", task)
            return Response(
                {"error": "Could not start the task."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class CompetitionStatsQueryView(APIView):
    permission_classes = [StatsPermissions]

    STATS_CACHE_TTL = 30  # seconds - burst absorption between changes

    def get(self, request, competition):
        # Generation-keyed cache: workout/point changes bump the
        # generation (scorer + recalc task), making old snapshots
        # unreachable within seconds - a logged workout shows up on the
        # challenge page immediately instead of after the cache window.
        # Between changes the 30s TTL still absorbs request bursts.
        generation = cache.get(f"stats-generation:{competition}", 0)
        cache_key = f"competition-stats:{competition}:gen{generation}"
        response_obj = cache.get(cache_key)
        if response_obj is None:
            response_obj = get_competition_stats(competition)
            cache.set(cache_key, response_obj, self.STATS_CACHE_TTL)
        self.check_object_permissions(request, response_obj)
        return Response(response_obj)


class FeedPermissions(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        # Same pattern as StatsPermissions: membership MUST be checked
        # here so a cached feed is never served to a non-participant.
        return Competition.objects.filter(
            Q(pk=view.kwargs.get("competition", 0)) & (Q(owner=request.user) | Q(user=request.user))
        ).exists()


class FeedQueryView(APIView):
    """ API view to get the activity/point feed for a competition. """
    permission_classes = [FeedPermissions]

    FEED_CACHE_TTL = 30  # seconds - burst absorption between changes

    def get(self, request, competition):
        # Same generation key as the stats view: workout/point changes
        # bump the generation, making old snapshots unreachable within
        # seconds; between changes the short TTL absorbs poll bursts.
        # (The feed rescans the competition's whole Points table twice -
        # too expensive to run uncached on every 60-90s poll.)
        generation = cache.get(f"stats-generation:{competition}", 0)
        cache_key = f"competition-feed:{competition}:gen{generation}"
        response_obj = cache.get(cache_key)
        if response_obj is None:
            all_points = Points.objects.filter(Q(award__competition__id=competition) | Q(goal__competition_id=competition)).order_by('-workout__start_datetime', '-workout__steps', '-workout__duration', '-workout', '-workout__user')

            grouped_points = {i['workout']: i for i in all_points.values('workout__user', 'workout__user__username', 'workout__user__strava_allow_follow', 'workout__user__profile_picture', 'workout', 'workout__sport_type', 'workout__start_datetime', 'workout__duration', 'workout__steps', 'workout__strava_id', 'award').annotate(points_capped=Sum('points_capped'), points_raw=Sum('points_raw')).order_by('-workout__start_datetime', '-workout__duration', '-workout', '-workout__user')}
            for row in grouped_points.values():
                pic = row.pop('workout__user__profile_picture', None)
                uid = row.get('workout__user')
                row['workout__user__profile_picture'] = f"/api/user/{uid}/picture/" if pic and uid else None

            for i in all_points.values('workout', 'id', 'goal', 'goal__name', 'award', 'award__name', 'points_capped', 'points_raw'):
                if 'details' not in grouped_points[i['workout']]:
                    grouped_points[i['workout']]['details'] = []
                grouped_points[i['workout']]['details'].append(i)

            response_obj = list(grouped_points.values())
            try:
                from django.utils import timezone as dj_tz
                from drill_instructor.models import DailyOrder
                today = dj_tz.localdate()
                order = DailyOrder.objects.filter(config__competition_id=competition, date=today).prefetch_related("completed_by").first()
                completers = set(order.completed_by.values_list("id", flat=True)) if order else set()
                for row in response_obj:
                    uid = row.get("workout__user")
                    start = row.get("workout__start_datetime")
                    on_today = False
                    if start is not None:
                        d = start.date() if hasattr(start, "date") else None
                        on_today = d == today
                    row["order_ribbon"] = bool(uid in completers and on_today)
            except Exception:
                for row in response_obj:
                    row["order_ribbon"] = False
            cache.set(cache_key, response_obj, self.FEED_CACHE_TTL)

        return Response(response_obj)



class JoinCompetitionView(APIView):
    """ API post view for users to join a competition. """
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'join'

    def post(self, request, join_code):
        competition = Competition.objects.filter(join_code=join_code.upper())
        if len(competition) == 0:
            return Response({"message": "Invalid join code."}, status=status.HTTP_400_BAD_REQUEST)
        competition = competition[0]
        competition.user.add(request.user)
        # m2m add already fires the scorer; a full save() would re-run
        # competition-change plumbing for no field change.
        return Response({"message": "Successfully joined competition.", "competition": competition.id}, status=status.HTTP_200_OK)

    def delete(self, request, join_code):
        # `join_code` here is actually the *competition id* - the URL
        # path is reused for POST and DELETE but the two payloads are
        # different things (POST takes a join code, DELETE takes an id).
        try:
            competition_id = int(join_code)
        except (TypeError, ValueError):
            return Response({"message": "Invalid competition id."}, status=status.HTTP_400_BAD_REQUEST)

        if not Competition.objects.filter(pk=competition_id).exists():
            return Response({"message": "Competition not found."}, status=status.HTTP_404_NOT_FOUND)

        if not request.user.my_competitions.filter(pk=competition_id).exists():
            # Don't leak that the user isn't a member - same response
            # either way. Avoids IDOR enumeration via the DELETE verb.
            return Response({"message": "Successfully left competition.", "competition": competition_id}, status=status.HTTP_200_OK)

        request.user.my_competitions.remove(competition_id)
        request.user.my_teams.remove(*list(request.user.my_teams.filter(competition=competition_id)))

        Points.objects.filter((Q(award__competition__id=competition_id) | Q(goal__competition_id=competition_id)) & Q(workout__user=request.user)).delete()

        return Response({"message": "Successfully left competition.", "competition": competition_id}, status=status.HTTP_200_OK)


class JoinTeamView(APIView):
    """ API post view for users to join a team and make sure they are only a member of one team per competition. """
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "join"

    def post(self, request):
        team_id = request.query_params.get('team')
        try:
            team_id = int(team_id)
        except (TypeError, ValueError):
            return Response({"message": "Invalid team id."}, status=status.HTTP_400_BAD_REQUEST)
        team = Team.objects.filter(id=team_id)
        if len(team) == 0:
            return Response({"message": "Invalid team id."}, status=status.HTTP_400_BAD_REQUEST)
        team = team[0]

        try:
            user_id = int(request.query_params.get('user', request.user.id))
        except (TypeError, ValueError):
            return Response({"message": "Invalid user id."}, status=status.HTTP_400_BAD_REQUEST)
        user = CustomUser.objects.filter(id=user_id)
        if len(user) == 0:
            return Response({"message": "Invalid user id."}, status=status.HTTP_400_BAD_REQUEST)
        user = user[0]

        competition = team.competition
        competition_teams = competition.team_set.all()

        target_is_self = (user.pk == request.user.pk)
        is_owner = (competition.owner_id == request.user.id)

        # Organizer-assigns-teams mode: only the owner may move anyone,
        # including members moving themselves.
        if competition.organizer_assigns_teams and not is_owner:
            return Response(
                {"message": "The organizer assigns teams in this competition."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Authorization rules:
        #   * A user can always move themselves (no need to be in no
        #     team first - that's what the dedup loop below enforces).
        #   * The competition owner can move any participant.
        #   * Anyone else can only move a user who is currently in
        #     *no* team in this competition - the previous version of
        #     this check allowed anyone to silently re-assign un-teamed
        #     participants to their own team, which let a regular
        #     participant scrape the participant list and shove people
        #     into the wrong team.
        target_in_a_team = competition_teams.filter(user=user).exists()

        if not target_is_self and not is_owner and target_in_a_team:
            return Response(
                {"message": "Unauthorized. You can only change your own team or move team-less participants."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Only the owner or the target themselves can move people into
        # a specific team when they had no team. Otherwise a regular
        # participant could add team-less competitors into their team.
        if not target_is_self and not is_owner and not target_in_a_team:
            return Response(
                {"message": "Unauthorized. Only the competition owner can assign un-teamed participants to a team."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Make sure the target is actually a participant of the
        # competition - otherwise we'd be adding a stranger to the
        # team rosters.
        if not competition.user.filter(pk=user.pk).exists():
            return Response(
                {"message": "User is not a participant of this competition."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.my_teams.remove(*list(user.my_teams.filter(competition=competition)))
        user.my_teams.add(team)

        return Response({"message": "Successfully joined team.", "team": team.id, "user": user.id}, status=status.HTTP_200_OK)
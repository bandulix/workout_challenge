import datetime
import logging

from django.db.models import Q
from django.core.exceptions import PermissionDenied
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework import status
from django.core.cache import cache
from custom_user.throttles import ClientIPScopedThrottle
from rest_framework.permissions import BasePermission

from django.db.models import Sum

logger = logging.getLogger(__name__)

from custom_user.permissions import IsCompetitionOwner, IsRelatedCompetitionOwner
from custom_user.models import CustomUser
from custom_user.point_recalc import recalc_points
from .models import Competition, Team, ActivityGoal, Points
from .serializers import CompetitionSerializer, TeamSerializer, ActivityGoalSerializer, PointsSerializer
from .stats import get_competition_stats, get_competition_rank_summary

from celery import current_app
import json

class CompetitionViewSet(viewsets.ModelViewSet):
    #queryset = Competition.objects.all()
    serializer_class = CompetitionSerializer

    permission_classes = [IsCompetitionOwner]

    def get_queryset(self):
        # return all competitions the user is owner of or a participant of
        #time.sleep(3)  # throttle for testing
        return Competition.objects.filter(Q(owner=self.request.user) | Q(user=self.request.user)).distinct().prefetch_related('user', 'activitygoal_set').order_by('-end_date', '-start_date', '-id')

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

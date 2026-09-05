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

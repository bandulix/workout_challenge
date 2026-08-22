"""Explicit permission classes - one owner rule per resource.

The old ``IsOwnerOrReadOnly`` duck-typed ``obj.user`` / ``obj.owner`` /
``obj.competition.owner``, which is how ``POST /api/point/`` used to
mint points: ``has_permission`` let any authenticated user through and
``create()`` never ran object checks.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsAuthenticatedUser(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)


class _StaffOrOwner(IsAuthenticatedUser):
    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if request.user.is_staff:
            return True
        return self._is_owner(request, obj)

    def _is_owner(self, request, obj):
        raise NotImplementedError


class IsWorkoutOwner(_StaffOrOwner):
    """Only the athlete who logged the workout may edit/delete it."""

    def _is_owner(self, request, obj):
        return getattr(obj, "user_id", None) == request.user.id


class IsCompetitionOwner(_StaffOrOwner):
    """Only the competition owner may edit/delete the competition."""

    def _is_owner(self, request, obj):
        return getattr(obj, "owner_id", None) == request.user.id


class IsRelatedCompetitionOwner(_StaffOrOwner):
    """Teams and activity goals: the parent competition's owner writes."""

    def _is_owner(self, request, obj):
        competition = getattr(obj, "competition", None)
        return competition is not None and competition.owner_id == request.user.id

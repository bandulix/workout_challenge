"""Celery autodiscover entry for this app.

Beat and the worker only import ``<app>.tasks``. Health/Strava/Garmin
sync, point recalc, and the email sweeps live in other modules - without
this import they stay unregistered and the hourly Health Connect poll
never runs (manual Re-Sync still works because it calls the task in the
web process).
"""

from . import garmin, health, point_recalc, strava  # noqa: F401
from .emails import celery_emails  # noqa: F401

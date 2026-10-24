import logging

from django.contrib.auth import get_user_model

from workout_challenge.celery import app, is_task_already_executing

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=1, default_retry_delay=60, time_limit=180)
def sync_user_recovery(self, user_id, days=None):
    """On-demand pull after an athlete opts in. Failures stay off the request."""
    from .sync import sync_user

    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return {"missing": user_id}
    try:
        return sync_user(user, days=days)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Recovery sync failed for user %s: %s", user_id, exc)
        return {"error": "failed"}


@app.task(bind=True, max_retries=1, default_retry_delay=60, time_limit=300)
def sweep_readiness(self):
    """Personal orders and the opt-in morning push. Quiet hours are enforced."""
    if is_task_already_executing("sweep_readiness"):
        return "Task already executing. Skipping."
    from .service import sweep
    return sweep()

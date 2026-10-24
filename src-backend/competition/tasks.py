"""Scheduled duel housekeeping. Beat runs this under supervisord."""

import logging

from workout_challenge.celery import app, is_task_already_executing

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=0, time_limit=120)
def settle_duels(self):
    if is_task_already_executing("settle_duels"):
        return {"skipped": True}
    from competition.duels import settle_due_duels
    try:
        return settle_due_duels()
    except Exception:
        logger.exception("Duel settle sweep failed")
        return {"settled": 0}

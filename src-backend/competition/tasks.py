"""Scheduled duel housekeeping. Beat runs this under supervisord."""

import logging

from workout_challenge.celery import app, is_task_already_executing

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=0, time_limit=300, soft_time_limit=270)
def settle_skiweek_crowns(self):
    if is_task_already_executing("settle_skiweek_crowns"):
        return {"skipped": True}
    from competition.skiweek import post_due_teasers, resort_day, settle_due_crowns
    from competition.ski_photos import coronate_if_ready
    from competition.models import SambucaSettlement, SkiWeekCampaign
    from django.utils import timezone
    try:
        crowns = settle_due_crowns()
        teasers = post_due_teasers()
        portraits = 0
        now = timezone.now()
        for campaign in SkiWeekCampaign.objects.filter(enabled=True):
            yesterday = resort_day(now, campaign.timezone, campaign.day_cutoff_hour)
            from datetime import timedelta
            yesterday = yesterday - timedelta(days=1)
            settlement = SambucaSettlement.objects.filter(campaign=campaign, resort_day=yesterday).first()
            if settlement is None:
                continue
            try:
                if coronate_if_ready(campaign, settlement) is not None:
                    portraits += 1
            except Exception:
                logger.warning("Ski coronation skipped for campaign %s", campaign.pk, exc_info=True)
        return {**crowns, **teasers, "portraits": portraits}
    except Exception:
        logger.exception("Ski week crown settle failed")
        return {"settled": 0}


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

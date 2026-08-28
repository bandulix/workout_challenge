import datetime
import logging

from django.db.models import Min
from django.utils import timezone

from django.core.cache import cache
from workout_challenge.celery import app, is_task_already_executing
from django.apps import apps
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)


def trigger_recalc_points():
    last_recalc = cache.get('last_recalc_points', None)

    if last_recalc is None or last_recalc < datetime.datetime.now() - datetime.timedelta(seconds=30):
        cache.set('last_recalc_points', datetime.datetime.now(), 60 * 10)
        eta = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=10)
        recalc_points.apply_async(eta=eta)
    else:
        logger.info('Recalc points task skipped because it was triggered less than 30 seconds ago')


def _incr_generation(key):
    try:
        cache.incr(key)
    except ValueError:
        cache.add(key, 1, None)


def bump_feed_generation(competition_ids):
    """Invalidate coach message-list pages (not the points/stats snapshots)."""
    for competition_id in set(cid for cid in competition_ids if cid):
        _incr_generation(f"feed-generation:{competition_id}")


def bump_stats_generation(competition_ids):
    """Invalidate points feed + stats + coach list.

    Stamps and chat use bump_feed_generation so they do not rebuild
    the season points snapshot.
    """
    ids = set(cid for cid in competition_ids if cid)
    for competition_id in ids:
        _incr_generation(f"stats-generation:{competition_id}")
    bump_feed_generation(ids)


@app.task(bind=True, time_limit=60 * 30, max_retries=3)  # 30 min time limit
def recalc_points(self):
    if is_task_already_executing('recalc_points'):
        logger.info('Recalc points task skipped because it is already running')
        return 'Skipped because it is already running.'

    logger.info('Recalculating points...')

    ActivityGoal = apps.get_model('competition', 'ActivityGoal')
    Points = apps.get_model('competition', 'Points')
    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')

    all_tasks = RecalcRequest.objects.filter(done=False)
    # Snapshot the ids NOW: rows created while we work must survive for
    # the next run - deleting the live queryset afterwards would swallow
    # them unprocessed (and leave points_capped stale).
    task_ids = list(all_tasks.values_list('pk', flat=True))
    grouped_tasks = all_tasks.values('user', 'goal').annotate(start_datetime=Min('start_datetime'))
    # in_bulk: one query for all groups instead of one get() per group.
    goal_map = ActivityGoal.objects.in_bulk({t['goal'] for t in grouped_tasks})
    for task_group in grouped_tasks:
        # select_related: Scorer dereferences points.workout several times
        # per row - without it every row costs an extra SELECT.
        points_lst = Points.objects.filter(goal=task_group['goal'], workout__user=task_group['user'], workout__start_datetime__gte=task_group['start_datetime']).select_related('workout').order_by('workout__start_datetime')

        goal = goal_map[task_group['goal']]

        recap_points_queryset(points_lst, goal)

    # Evaluate before the delete below empties the queryset.
    goal_ids = {task_group['goal'] for task_group in grouped_tasks}

    RecalcRequest.objects.filter(pk__in=task_ids).delete()

    # The capped points just changed: bust the stats snapshots so the
    # leaderboard refetch right after a workout shows the final numbers.
    competition_ids = ActivityGoal.objects.filter(pk__in=goal_ids).values_list('competition_id', flat=True)
    bump_stats_generation(competition_ids)

    logger.info('All points recalculated.')
    return [{k: str(v) for k, v in i.items()} for i in grouped_tasks]


def recap_points_queryset(points_lst, goal):
    """Apply floor/cap math to an ordered (start_datetime) Points queryset."""
    Points = apps.get_model('competition', 'Points')
    scorer = Scorer()
    scorer.set_goal(goal)
    changed_rows = []
    for points in points_lst:
        earned_points = scorer.calculate_points(points)
        if points.points_capped != earned_points:
            points.points_capped = earned_points
            changed_rows.append(points)
    if changed_rows:
        Points.objects.bulk_update(changed_rows, ['points_capped'], batch_size=500)
    return len(changed_rows)


def recap_goal(goal, from_datetime=None):
    """Re-apply caps for every participant of ``goal``, oldest workout first.

    Used by the goal-edit path so a challenge retarget does not wait on
    the 30s Celery throttle (and does not leave every row at uncapped raw,
    which then all slam into the same daily cap on a later run).
    """
    Points = apps.get_model('competition', 'Points')
    user_ids = (
        Points.objects.filter(goal=goal)
        .values_list('workout__user_id', flat=True)
        .distinct()
    )
    for user_id in user_ids:
        qs = Points.objects.filter(goal=goal, workout__user_id=user_id)
        if from_datetime is not None:
            qs = qs.filter(workout__start_datetime__gte=from_datetime)
        qs = qs.select_related('workout').order_by('workout__start_datetime')
        recap_points_queryset(qs, goal)


def _local_dt(dt):
    """Scorer day/week buckets must follow the competition timezone.

    ``datetime.date()`` / ``isocalendar()`` on a UTC-aware timestamp use
    the UTC calendar. A 23:00 Europe/London workout is the next UTC day,
    so a goal-change recap of the whole challenge could dump several
    local days into one bucket and slam them all into the same daily cap.
    """
    if dt is None:
        return None
    if timezone.is_aware(dt):
        return timezone.localtime(dt)
    return timezone.make_aware(dt, timezone.get_current_timezone())


class Scorer:
    def __init__(self):
        self.memory_today = None
        self.memory_today_points_raw = 0
        self.memory_today_points_capped = 0
        self.memory_this_week = None
        self.memory_week_points_raw = 0
        self.memory_week_points_capped = 0

    def set_goal(self, goal):
        self.goal = goal
        self.floor_workout = 0 if goal.min_per_workout is None else goal.min_per_workout / goal.goal * 100
        self.cap_workout = None if goal.max_per_workout is None else goal.max_per_workout / goal.goal * 100
        self.floor_day = 0 if goal.min_per_day is None else goal.min_per_day / goal.goal * 100
        self.cap_day = None if goal.max_per_day is None else goal.max_per_day / goal.goal * 100
        self.floor_week = 0 if goal.min_per_week is None else goal.min_per_week / goal.goal * 100
        self.cap_week = None if goal.max_per_week is None else goal.max_per_week / goal.goal * 100

    def calculate_points(self, points):
        local = _local_dt(points.workout.start_datetime)
        today = local.date()
        iso = local.isocalendar()
        this_week = (iso[0], iso[1])  # year + week; week-only wraps every January

        # potentially reset the memory if new day / week
        if today != self.memory_today:
            self.memory_today = today
            self.memory_today_points_raw = 0
            self.memory_today_points_capped = 0
        if this_week != self.memory_this_week:
            self.memory_this_week = this_week
            self.memory_week_points_raw = 0
            self.memory_week_points_capped = 0

        earned_points = points.points_raw
        self.memory_today_points_raw += earned_points
        self.memory_week_points_raw += earned_points
        earned_points = points.points_raw

        # workout floor
        earned_points = max(earned_points - self.floor_workout, 0)

        # workout cap
        if self.cap_workout is not None:
            adjusted_cap = self.cap_workout - self.floor_workout
            earned_points = min(earned_points, adjusted_cap)

        # day floor
        earned_points = max(min(earned_points, self.memory_today_points_raw - self.floor_day), 0)

        # day cap
        if self.cap_day is not None:
            max_points_to_earn_today = self.cap_day - self.floor_day
            earned_points = max(min(earned_points, max_points_to_earn_today - self.memory_today_points_capped),0)

        # week floor
        earned_points = max(min(earned_points, self.memory_week_points_raw - self.floor_week), 0)

        # week cap
        if self.cap_week is not None:
            max_points_to_earn_week = self.cap_week - self.floor_week
            earned_points = max(min(earned_points, max_points_to_earn_week - self.memory_week_points_capped),0)


        self.memory_today_points_capped += earned_points
        self.memory_week_points_capped += earned_points
        return earned_points

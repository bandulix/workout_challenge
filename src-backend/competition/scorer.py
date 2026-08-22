import datetime
import logging

from django.apps import apps
from django.core.cache import cache
from django.utils import timezone

from custom_user.point_recalc import bump_stats_generation, trigger_recalc_points

logger = logging.getLogger(__name__)

_SPORT_FACTORS_CACHE_KEY = "sport-points-factors"


def get_sport_factors() -> dict:
    """Site-wide per-activity-type point multipliers (SiteSettings).

    Read on every scored workout, so cache briefly - the admin edit path
    (``apply_sport_factor_changes``) invalidates on change.
    """
    factors = cache.get(_SPORT_FACTORS_CACHE_KEY)
    if factors is None:
        from site_settings.models import SiteSettings
        factors = SiteSettings.get_solo().points_sport_factors or {}
        cache.set(_SPORT_FACTORS_CACHE_KEY, factors, 60)
    return factors


def sport_factor(sport_type, factors=None) -> float:
    """Multiplier for one sport type; 1.0 (neutral) when unset/invalid."""
    factors = get_sport_factors() if factors is None else factors
    try:
        return float(factors.get(sport_type, 1.0))
    except (TypeError, ValueError, AttributeError):
        return 1.0


def _calculate_points_raw(goal, workout, user, factors=None):
    goal_metric = goal.metric
    goal_target = float(goal.goal)

    if goal_metric == 'min':
        if workout.duration is None or workout.duration == '':
            points = 0
        else:
            points = float(workout.duration.total_seconds()) / 60 / goal_target
    elif goal_metric == 'num':
        points = 1 / goal_target
    elif goal_metric == 'kcal':
        if workout.kcal is None or workout.kcal == '':
            points = 0
        else:
            points = float(workout.kcal) / (goal_target * float(user.scaling_kcal))
    elif goal_metric == 'km':
        if workout.distance is None or workout.distance == '':
            points = 0
        else:
            points = float(workout.distance) / (goal_target * float(user.scaling_distance))
    elif goal_metric == 'kj':
        if workout.kcal is None or workout.kcal == '':
            points = 0
        else:
            points = float(workout.kcal) * 4.18 / (goal_target * float(user.scaling_kcal))
    return points * 100 * sport_factor(workout.sport_type, factors)


def _bust_stats_cache_for(user):
    """Invalidate the cached stats snapshots of every competition the
    user participates in - a logged/changed/deleted workout must show up
    on the challenge page immediately, not after the 30s cache window."""
    bump_stats_generation(user.my_competitions.values_list("pk", flat=True))


def apply_sport_factor_changes(old_factors: dict, new_factors: dict):
    """Re-score after the admin edited per-activity-type point factors.

    Recomputes ``points_raw`` for every Points row whose workout's sport
    type changed factor, then enqueues the cap recalc per affected
    (user, goal) pair. Admin edits are rare, so the full scan is fine.
    """
    def _norm(factors, sport):
        try:
            return float(factors.get(sport, 1.0))
        except (TypeError, ValueError):
            return 1.0

    changed_sports = {
        s for s in set(old_factors) | set(new_factors)
        if _norm(old_factors, s) != _norm(new_factors, s)
    }
    cache.delete(_SPORT_FACTORS_CACHE_KEY)
    if not changed_sports:
        return

    Points = apps.get_model('competition', 'Points')
    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')

    recalc_pairs = set()
    rows_to_update = []
    rows = Points.objects.filter(
        workout__sport_type__in=changed_sports,
    ).select_related('workout', 'goal', 'workout__user')
    for row in rows:
        new_raw = _calculate_points_raw(row.goal, row.workout, row.workout.user, factors=new_factors)
        if float(row.points_raw) != new_raw:
            row.points_raw = new_raw
            row.points_capped = new_raw
            rows_to_update.append(row)
        recalc_pairs.add((row.workout.user_id, row.goal_id))

    if rows_to_update:
        Points.objects.bulk_update(rows_to_update, ['points_raw', 'points_capped'], batch_size=500)

    # in_bulk: one query instead of one per recalc pair.
    ActivityGoal = apps.get_model('competition', 'ActivityGoal')
    goal_map = ActivityGoal.objects.filter(
        pk__in={goal_id for _, goal_id in recalc_pairs},
    ).select_related('competition').in_bulk()
    RecalcRequest.objects.bulk_create([
        RecalcRequest(
            user_id=user_id, goal_id=goal_id,
            start_datetime=goal_map[goal_id].competition.start_date,
        )
        for user_id, goal_id in recalc_pairs
    ])
    trigger_recalc_points()
    logger.info("Sport factor change (%s) re-scored %s point rows, %s recalc pairs",
                sorted(changed_sports), len(rows_to_update), len(recalc_pairs))


def score_workout(instance, *, new, changes):
    """Public scoring entry: persist Points for a saved workout.

    Call this from the API serializer / syncs after ``Workout.save``.
    ``Workout.save(score=True)`` (the default) delegates here so ORM
    creates used by tests and the three import connectors keep working.
    """
    trigger_workout_change(instance, new, changes)


def unscore_workout(instance):
    """Public scoring entry: drop Points for a workout about to be deleted."""
    trigger_workout_delete(instance)


def trigger_workout_delete(instance):
    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')
    for points in instance.points_set.all():
        RecalcRequest(user=instance.user, goal=points.goal, start_datetime=instance.start_datetime).save()
    logger.info("Workout %s deletion triggered point cap recalc after %s", instance.pk, instance.start_datetime.isoformat())

    _bust_stats_cache_for(instance.user)
    trigger_recalc_points()


def trigger_workout_change(instance, new, changes):

    # No-op saves (hourly syncs re-save every known activity even when
    # nothing changed) must not bust the stats caches or enqueue a
    # recalc - that would invalidate every challenge snapshot for nothing.
    if not new and not changes:
        return

    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')
    Points = apps.get_model('competition', 'Points')
    # Hoisted once per save instead of one cache/DB read per goal.
    factors = get_sport_factors()

    if new:
        # newly created workout - add point entries
        start_datetime = datetime.datetime.strptime(instance.start_datetime, '%Y-%m-%dT%H:%M:%SZ') if type(instance.start_datetime) is str else instance.start_datetime
        new_points = []
        new_requests = []
        for competition in instance.user.my_competitions.filter(start_date__lte=start_datetime, end_date__gte=start_datetime).prefetch_related('activitygoal_set'):
            for goal in competition.activitygoal_set.all():
                if goal.count_steps_as_walks or instance.sport_type != 'Steps':
                    points = _calculate_points_raw(goal=goal, workout=instance, user=instance.user, factors=factors)
                    new_points.append(Points(goal=goal, workout=instance, points_raw=points, points_capped=points))
                    new_requests.append(RecalcRequest(user=instance.user, goal=goal, start_datetime=start_datetime))
        if new_points:
            Points.objects.bulk_create(new_points)
        if new_requests:
            RecalcRequest.objects.bulk_create(new_requests)

        # hand off to the AI Drill Instructor (no-op if no competition
        # for this workout has it enabled). Imported lazily to avoid a
        # circular import with apps.get_model at import time.
        try:
            from drill_instructor.tasks import post_workout_comment
            post_workout_comment.delay(instance.pk)
        except Exception:  # noqa: BLE001 - never block workout saves on instructor plumbing
            logger.exception("Drill Instructor: failed to enqueue comment for workout %s", instance.pk)
    else:
        # updated existing workout
        # check if relevant field was changed
        metric_change_lst = []
        if 'start_datetime' in changes:
            metric_change_lst.extend(['min', 'num', 'kcal', 'km', 'kj'])
        if 'duration' in changes:
            metric_change_lst.extend(['min'])
        if 'kcal' in changes:
            metric_change_lst.extend(['kcal', 'kj'])
        if 'distance' in changes:
            metric_change_lst.extend(['km'])

        recalc_start_datetime = changes.get('start_datetime', [instance.start_datetime])[0]
        # select_related: goal is dereferenced per row in the filter.
        points_to_update = []
        requests = []
        for recalc_points in instance.points_set.all().select_related('goal'):
            if recalc_points.goal.metric not in metric_change_lst:
                continue
            points = _calculate_points_raw(goal=recalc_points.goal, workout=instance, user=instance.user, factors=factors)
            recalc_points.points_raw = points
            recalc_points.points_capped = points
            points_to_update.append(recalc_points)
            requests.append(RecalcRequest(user=instance.user, goal=recalc_points.goal, start_datetime=recalc_start_datetime))
        if points_to_update:
            Points.objects.bulk_update(points_to_update, ['points_raw', 'points_capped'], batch_size=500)
        if requests:
            RecalcRequest.objects.bulk_create(requests)

    # Avoid logging the full changes dict - it contains all fields,
    # which is more than we need for an audit trail.
    if new:
        logger.info("Workout (%s) update triggered point cap recalc - NEW ENTRY", instance.pk)
    else:
        changed_fields = list(changes.keys()) if isinstance(changes, dict) else []
        logger.info("Workout (%s) update triggered point cap recalc - EXISTING CHANGED (%s)",
                    instance.pk, changed_fields)

    _bust_stats_cache_for(instance.user)
    trigger_recalc_points()


def trigger_goal_change(instance, new, changes):
    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')
    Points = apps.get_model('competition', 'Points')
    Workout = apps.get_model('workouts', 'Workout')
    if new:
        # newly created goal - add point entries
        workout_lst = Workout.objects.filter(start_datetime__gte=instance.competition.start_date, start_datetime__lte=instance.competition.end_date + datetime.timedelta(days=1), user__in=instance.competition.user.all()).select_related('user')
        if instance.count_steps_as_walks is False:
            workout_lst = workout_lst.exclude(sport_type='Steps')
        factors = get_sport_factors()
        new_points = []
        new_requests = []
        for workout in workout_lst:
            points = _calculate_points_raw(goal=instance, workout=workout, user=workout.user, factors=factors)
            new_points.append(Points(goal=instance, workout=workout, points_raw=points, points_capped=points))
            new_requests.append(RecalcRequest(user=workout.user, goal=instance, start_datetime=workout.start_datetime))
        if new_points:
            Points.objects.bulk_create(new_points)
        if new_requests:
            RecalcRequest.objects.bulk_create(new_requests)
    else:
        # Name-only edits don't change scoring.
        scoring_changes = {k: v for k, v in changes.items() if k != 'name'}
        if not scoring_changes:
            return

        if 'count_steps_as_walks' in scoring_changes:
            # add steps
            if scoring_changes['count_steps_as_walks'][1]:
                factors = get_sport_factors()
                new_points = []
                for workout in Workout.objects.filter(start_datetime__gte=instance.competition.start_date, start_datetime__lte=instance.competition.end_date + datetime.timedelta(days=1), user__in=instance.competition.user.all(), sport_type='Steps').select_related('user'):
                    points = _calculate_points_raw(goal=instance, workout=workout, user=workout.user, factors=factors)
                    new_points.append(Points(goal=instance, workout=workout, points_raw=points, points_capped=points))
                if new_points:
                    Points.objects.bulk_create(new_points)
            # remove steps
            else:
                instance.points_set.filter(workout__sport_type='Steps').delete()

        # Target / metric / step-counting change the raw formula. Cap-only
        # edits leave points_raw alone. Either way recap from day 1 of
        # the challenge so the whole duration uses the new rules.
        if {'metric', 'goal', 'count_steps_as_walks'} & scoring_changes.keys():
            factors = get_sport_factors()
            rows_to_update = []
            for row in instance.points_set.select_related('workout', 'workout__user'):
                new_raw = _calculate_points_raw(instance, row.workout, row.workout.user, factors=factors)
                if float(row.points_raw) != new_raw:
                    row.points_raw = new_raw
                    row.points_capped = new_raw
                    rows_to_update.append(row)
            if rows_to_update:
                Points.objects.bulk_update(rows_to_update, ['points_raw', 'points_capped'], batch_size=500)

        start_dt = timezone.make_aware(
            datetime.datetime.combine(instance.competition.start_date, datetime.time.min),
            timezone.get_current_timezone(),
        )
        RecalcRequest.objects.bulk_create([
            RecalcRequest(user=user, goal=instance, start_datetime=start_dt)
            for user in instance.competition.user.all()
        ])
        bump_stats_generation([instance.competition_id])

    trigger_recalc_points()


def trigger_competition_change(instance, new, changes):
    Points = apps.get_model('competition', 'Points')
    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')
    Workout = apps.get_model('workouts', 'Workout')

    # newly created competitions are ignored as only relevant if new goals are created
    # only catching changes of the start_date and end_date below

    if 'start_date' in changes:
        if changes['start_date'][1] < changes['start_date'][0]:
            # add point entries before changes['start_date'][0] till [1]
            factors = get_sport_factors()
            new_points = []
            new_requests = []
            workouts = Workout.objects.filter(start_datetime__gte=changes['start_date'][1], start_datetime__lte=changes['start_date'][0], user__in=instance.user.all()).select_related('user')
            for goal in instance.activitygoal_set.all():
                for workout in workouts:
                    points = _calculate_points_raw(goal=goal, workout=workout, user=workout.user, factors=factors)
                    new_points.append(Points(goal=goal, workout=workout, points_raw=points, points_capped=points))
                    new_requests.append(RecalcRequest(user=workout.user, goal=goal, start_datetime=workout.start_datetime))
            if new_points:
                Points.objects.bulk_create(new_points)
            if new_requests:
                RecalcRequest.objects.bulk_create(new_requests)
            logger.info("Competition %s start_date extended %s → %s, triggering cap recalc", instance.pk, changes['start_date'][0], changes['start_date'][1])
        else:
            # remove point entries before changes['start_date'][1]
            points_to_delete = Points.objects.filter(goal__competition=instance, workout__start_datetime__lt=changes['start_date'][1])
            # Only (user, goal) pairs that actually lost points need a
            # recalc - not the full cartesian product of the deleted set.
            affected_pairs = set(points_to_delete.values_list('workout__user', 'goal').distinct())
            points_to_delete.delete()
            if affected_pairs:
                RecalcRequest.objects.bulk_create([
                    RecalcRequest(user_id=user_id, goal_id=goal_id, start_datetime=changes['start_date'][1])
                    for user_id, goal_id in affected_pairs
                ])
            logger.info("Competition %s start_date shortened %s → %s, triggering cap recalc", instance.pk, changes['start_date'][0], changes['start_date'][1])

        trigger_recalc_points()

    if 'end_date' in changes:
        if changes['end_date'][1] > changes['end_date'][0]:
            # add point entries after changes['end_date'][0] till [1]
            factors = get_sport_factors()
            new_points = []
            new_requests = []
            workouts = Workout.objects.filter(start_datetime__gte=changes['end_date'][0] + datetime.timedelta(days=1), start_datetime__lte=changes['end_date'][1] + datetime.timedelta(days=1), user__in=instance.user.all()).select_related('user')
            for goal in instance.activitygoal_set.all():
                for workout in workouts:
                    points = _calculate_points_raw(goal=goal, workout=workout, user=workout.user, factors=factors)
                    new_points.append(Points(goal=goal, workout=workout, points_raw=points, points_capped=points))
                    new_requests.append(RecalcRequest(user=workout.user, goal=goal, start_datetime=workout.start_datetime))
            if new_points:
                Points.objects.bulk_create(new_points)
            if new_requests:
                RecalcRequest.objects.bulk_create(new_requests)
            logger.info("Competition %s end_date extended %s → %s, triggering cap recalc", instance.pk, changes['end_date'][0], changes['end_date'][1])
        else:
            # remove point entries after changes['end_date'][1]
            Points.objects.filter(goal__competition=instance, workout__start_datetime__gt=changes['end_date'][1]).delete()
            logger.info("Competition %s end_date shortened %s → %s, not triggering cap recalc", instance.pk, changes['end_date'][0], changes['end_date'][1])

        trigger_recalc_points()


def trigger_user_change(instance, new, changes):
    Points = apps.get_model('competition', 'Points')
    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')

    # check if user leaves or joins a competition
    if 'my_competitions' in changes:
        # instance user obj / changes = pk_set comp id to add/remove
        if changes['my_competitions'][0] is None:
            # add/join competition
            Workout = apps.get_model('workouts', 'Workout')
            Competition = apps.get_model('competition', 'Competition')
            factors = get_sport_factors()
            new_points = []
            new_requests = []
            for competition in Competition.objects.filter(pk__in=changes['my_competitions'][1]).prefetch_related('activitygoal_set'):
                workout_lst = Workout.objects.filter(user=instance, start_datetime__gte=competition.start_date, start_datetime__lte=competition.end_date + datetime.timedelta(days=1))
                for goal in competition.activitygoal_set.all():
                    for workout in workout_lst:
                        points = _calculate_points_raw(goal=goal, workout=workout, user=instance, factors=factors)
                        new_points.append(Points(goal=goal, workout=workout, points_raw=points, points_capped=points))
                    new_requests.append(RecalcRequest(user=instance, goal=goal, start_datetime=competition.start_date))
            if new_points:
                Points.objects.bulk_create(new_points)
            if new_requests:
                RecalcRequest.objects.bulk_create(new_requests)
            logger.info("User %s joined competitions %s, triggering cap recalc", instance.pk, changes['my_competitions'][1])
        else:
            # remove/leave competition
            Points.objects.filter(goal__competition__in=changes['my_competitions'][0], workout__user=instance).delete()
            logger.info("User %s left competitions %s, not triggering cap recalc", instance.pk, changes['my_competitions'][0])

        trigger_recalc_points()

    # check if equalizing / scaling factors were changed
    if 'scaling_distance' in changes or 'scaling_kcal' in changes:
        goal_metrics = (['km'] if 'scaling_distance' in changes else []) + (['kcal', 'kj'] if 'scaling_kcal' in changes else [])
        # select_related: goal and workout are dereferenced per row.
        recalc_points = Points.objects.filter(goal__metric__in=goal_metrics, workout__user=instance).select_related('goal', 'workout')

        factors = get_sport_factors()
        points_to_update = []
        requests = []
        for recalc_point in recalc_points:
            points = _calculate_points_raw(goal=recalc_point.goal, workout=recalc_point.workout, user=instance, factors=factors)
            recalc_point.points_raw = points
            recalc_point.points_capped = points
            points_to_update.append(recalc_point)
            requests.append(RecalcRequest(user=instance, goal=recalc_point.goal, start_datetime=recalc_point.workout.start_datetime))
        if points_to_update:
            Points.objects.bulk_update(points_to_update, ['points_raw', 'points_capped'], batch_size=500)
        if requests:
            RecalcRequest.objects.bulk_create(requests)

        logger.info("User %s scaling factors %s changed, triggering cap recalc", instance.pk, goal_metrics)

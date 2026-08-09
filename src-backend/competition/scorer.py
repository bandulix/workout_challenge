import datetime
import logging

from django.apps import apps
from django.core.cache import cache

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
    touched = 0
    rows = Points.objects.filter(
        workout__sport_type__in=changed_sports,
    ).select_related('workout', 'goal', 'workout__user')
    for row in rows:
        new_raw = _calculate_points_raw(row.goal, row.workout, row.workout.user, factors=new_factors)
        if float(row.points_raw) != new_raw:
            row.points_raw = new_raw
            row.points_capped = new_raw
            row.save(update_fields=['points_raw', 'points_capped'])
            touched += 1
        recalc_pairs.add((row.workout.user_id, row.goal_id))

    # in_bulk: one query instead of one per recalc pair.
    ActivityGoal = apps.get_model('competition', 'ActivityGoal')
    goal_map = ActivityGoal.objects.filter(
        pk__in={goal_id for _, goal_id in recalc_pairs},
    ).select_related('competition').in_bulk()
    for user_id, goal_id in recalc_pairs:
        RecalcRequest(
            user_id=user_id, goal_id=goal_id,
            start_datetime=goal_map[goal_id].competition.start_date,
        ).save()
    trigger_recalc_points()
    logger.info("Sport factor change (%s) re-scored %s point rows, %s recalc pairs",
                sorted(changed_sports), touched, len(recalc_pairs))


def trigger_workout_delete(instance):
    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')
    for points in instance.points_set.all():
        RecalcRequest(user=instance.user, goal=points.goal, start_datetime=instance.start_datetime).save()
    print(f"Workout ({instance.pk}) deletion triggered point cap recalc - after {instance.start_datetime.isoformat()}")

    _bust_stats_cache_for(instance.user)
    trigger_recalc_points()


def trigger_workout_change(instance, new, changes):

    RecalcRequest = apps.get_model('custom_user', 'RecalcRequest')

    if new:
        # newly created workout - add point entries
        Points = apps.get_model('competition', 'Points')
        start_datetime = datetime.datetime.strptime(instance.start_datetime, '%Y-%m-%dT%H:%M:%SZ') if type(instance.start_datetime) is str else instance.start_datetime
        for competition in instance.user.my_competitions.filter(start_date__lte=start_datetime, end_date__gte=start_datetime):
            for goal in competition.activitygoal_set.all():
                if goal.count_steps_as_walks or instance.sport_type != 'Steps':
                    points = _calculate_points_raw(goal=goal, workout=instance, user=instance.user)
                    Points(goal=goal, workout=instance, points_raw=points, points_capped=points).save()
                    RecalcRequest(user=instance.user, goal=goal, start_datetime=start_datetime).save()

        # hand off to the AI Drill Instructor (no-op if no competition
        # for this workout has it enabled). Imported lazily to avoid a
        # circular import with apps.get_model at import time.
        try:
            from drill_instructor.tasks import post_workout_comment
            post_workout_comment.delay(instance.pk)
        except Exception:  # noqa: BLE001 - never block workout saves on instructor plumbing
            print(f"Drill Instructor: failed to enqueue comment for workout {instance.pk}")
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
        for recalc_points, recalc_goal in [(i, i.goal) for i in instance.points_set.all() if i.goal.metric in metric_change_lst]:
            points = _calculate_points_raw(goal=recalc_goal, workout=instance, user=instance.user)
            setattr(recalc_points, 'points_raw', points)
            setattr(recalc_points, 'points_capped', points)
            recalc_points.save()
            RecalcRequest(user=instance.user, goal=recalc_goal, start_datetime=recalc_start_datetime).save()

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
        workout_lst = Workout.objects.filter(start_datetime__gte=instance.competition.start_date, start_datetime__lte=instance.competition.end_date + datetime.timedelta(days=1), user__in=instance.competition.user.all())
        if instance.count_steps_as_walks is False:
            workout_lst = workout_lst.exclude(sport_type='Steps')
        for workout in workout_lst:
            points = _calculate_points_raw(goal=instance, workout=workout, user=workout.user)
            Points(goal=instance, workout=workout, points_raw=points, points_capped=points).save()
            RecalcRequest(user=workout.user, goal=instance, start_datetime=workout.start_datetime).save()
    else:
        # updated existing workout
        # check if relevant field was changed
        _ = changes.pop('name', None)
        if len(changes) > 0:
            if 'count_steps_as_walks' in changes:
                # add steps
                if changes['count_steps_as_walks'][1]:
                    for workout in Workout.objects.filter(start_datetime__gte=instance.competition.start_date, start_datetime__lte=instance.competition.end_date + datetime.timedelta(days=1), user__in=instance.competition.user.all(), sport_type='Steps'):
                        points = _calculate_points_raw(goal=instance, workout=workout, user=workout.user)
                        Points(goal=instance, workout=workout, points_raw=points, points_capped=points).save()
                # remove steps
                else:
                    for point in instance.points_set.filter(workout__sport_type='Steps'):
                        point.delete()
            for user in instance.competition.user.all():
                RecalcRequest(user=user, goal=instance, start_datetime=instance.competition.start_date).save()

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
            for goal in instance.activitygoal_set.all():
                for workout in Workout.objects.filter(start_datetime__gte=changes['start_date'][1], start_datetime__lte=changes['start_date'][0], user__in=instance.user.all()):
                    points = _calculate_points_raw(goal=goal, workout=workout, user=workout.user)
                    Points(goal=goal, workout=workout, points_raw=points, points_capped=points).save()
                    RecalcRequest(user=workout.user, goal=goal, start_datetime=workout.start_datetime).save()
            print(f"Competition ({instance.pk}) start_date was extended from {changes['start_date'][0]} to {changes['start_date'][1]} triggering point cap recalc")
        else:
            # remove point entries before changes['start_date'][1]
            points_to_delete = Points.objects.filter(goal__competition=instance, workout__start_datetime__lt=changes['start_date'][1])
            CustomUser = apps.get_model('custom_user', 'CustomUser')
            ActivityGoal = apps.get_model('competition', 'ActivityGoal')
            # in_bulk: one query per model instead of one get() per row.
            users = CustomUser.objects.in_bulk(set(points_to_delete.values_list('workout__user', flat=True)))
            goals = ActivityGoal.objects.in_bulk(set(points_to_delete.values_list('goal', flat=True)))
            for user in users.values():
                for goal in goals.values():
                    RecalcRequest(user=user, goal=goal, start_datetime=changes['start_date'][1]).save()
            points_to_delete.delete()
            print(f"Competition ({instance.pk}) start_date was shortened from {changes['start_date'][0]} to {changes['start_date'][1]} triggering point cap recalc")

        trigger_recalc_points()

    if 'end_date' in changes:
        if changes['end_date'][1] > changes['end_date'][0]:
            # add point entries after changes['end_date'][0] till [1]
            for goal in instance.activitygoal_set.all():
                for workout in Workout.objects.filter(start_datetime__gte=changes['end_date'][0] + datetime.timedelta(days=1), start_datetime__lte=changes['end_date'][1] + datetime.timedelta(days=1), user__in=instance.user.all()):
                    points = _calculate_points_raw(goal=goal, workout=workout, user=workout.user)
                    Points(goal=goal, workout=workout, points_raw=points, points_capped=points).save()
                    RecalcRequest(user=workout.user, goal=goal, start_datetime=workout.start_datetime).save()
            print(f"Competition ({instance.pk}) end_date was extended from {changes['end_date'][0]} to {changes['end_date'][1]} triggering point cap recalc")
        else:
            # remove point entries after changes['end_date'][1]
            Points.objects.filter(goal__competition=instance, workout__start_datetime__gt=changes['end_date'][1]).delete()
            print(f"Competition ({instance.pk}) end_date was shortened from {changes['end_date'][0]} to {changes['end_date'][1]} NOT triggering point cap recalc")

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
            for competition in Competition.objects.filter(pk__in=changes['my_competitions'][1]):
                workout_lst = Workout.objects.filter(user=instance, start_datetime__gte=competition.start_date, start_datetime__lte=competition.end_date + datetime.timedelta(days=1))
                for goal in competition.activitygoal_set.all():
                    for workout in workout_lst:
                        points = _calculate_points_raw(goal=goal, workout=workout, user=instance)
                        Points(goal=goal, workout=workout, points_raw=points, points_capped=points).save()
                    RecalcRequest(user=instance, goal=goal, start_datetime=competition.start_date).save()
            print(f"User ({instance.pk}) join competitions {changes['my_competitions'][1]} triggering point cap recalc")
        else:
            # remove/leave competition
            Points.objects.filter(goal__competition__in=changes['my_competitions'][0], workout__user=instance).delete()
            print(f"User ({instance.pk}) left competitions {changes['my_competitions'][0]} NOT triggering point cap recalc")

        trigger_recalc_points()

    # check if equalizing / scaling factors were changed
    if 'scaling_distance' in changes or 'scaling_kcal' in changes:
        goal_metrics = (['km'] if 'scaling_distance' in changes else []) + (['kcal', 'kj'] if 'scaling_kcal' in changes else [])
        recalc_points = Points.objects.filter(goal__metric__in=goal_metrics, workout__user=instance)

        for recalc_point in recalc_points:
            points = _calculate_points_raw(goal=recalc_point.goal, workout=recalc_point.workout, user=instance)
            setattr(recalc_point, 'points_raw', points)
            setattr(recalc_point, 'points_capped', points)
            recalc_point.save()
            RecalcRequest(user=instance, goal=recalc_point.goal, start_datetime=recalc_point.workout.start_datetime).save()

        print(f"User ({instance.pk}) scaling factors {goal_metrics} changed triggering point cap recalc")

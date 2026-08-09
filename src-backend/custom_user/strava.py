import requests
import time, datetime

from django.core.cache import cache
from django.contrib.auth import get_user_model
from django.conf import settings
from django.utils import timezone
from workout_challenge.celery import app, is_task_already_executing
from django.db.models import Q

from workouts.models import Workout, SPORT_TYPES, find_duplicate_workout
from .api_rate_limiter import strava_api_monitor, RateLimitExceeded  # Import to trigger initialization
from .token_crypto import decrypt_token, encrypt_token

# Strava keeps adding sport types faster than we do (e.g. Basketball,
# Cricket, Dance, Padel, Physical Therapy, Volleyball in 2026). The
# `choices` on Workout.sport_type are not DB-enforced, so without this
# guard unknown values would land in the table verbatim - and a frontend
# label lookup that expects a known type then crashes the whole page.
_VALID_SPORT_TYPES = {key for key, _label in SPORT_TYPES}


def _map_sport_type(strava_sport_type):
    return strava_sport_type if strava_sport_type in _VALID_SPORT_TYPES else 'Workout'

# Every outbound Strava request gets a hard timeout so a hung Strava
# API can't park a Celery worker (or the gunicorn worker serving the
# interactive link/sync endpoints) forever.
STRAVA_HTTP_TIMEOUT = 15


def _get_refresh_token(user):
    """Return the user's Strava refresh token, transparently handling
    both encrypted-at-rest values and legacy plaintext ones (pre-
    encryption rows are re-saved encrypted on first successful use)."""
    return decrypt_token(user.strava_refresh_token)


def _seconds_until_next_interval():
    current_time = time.localtime()
    minutes = current_time.tm_min
    seconds = current_time.tm_sec

    # Calculate the next interval (15, 30, 45, or 0 of the next hour)
    next_interval = (minutes // 15 + 1) * 15
    if next_interval == 60:  # Handle the case where it rolls over to the next hour
        next_interval = 0

    # Calculate the seconds until the next interval
    seconds_until = (next_interval - minutes) * 60 - seconds
    if next_interval == 0:  # Adjust for the next hour
        seconds_until += 3600

    return seconds_until


@app.task(bind=True, time_limit=60 * 60 * 3, max_retries=10)  # 3 hour time limit
def daily_strava_sync(self, refresh_all=False):
    if is_task_already_executing('daily_strava_sync'):
        return 'Task already executing. Skipping.'

    CustomUser = get_user_model()
    user_lst = CustomUser.objects.filter(
        strava_refresh_token__isnull=False,
        is_active=True
    )
    if refresh_all is False:
        # Per-user throttle: beat runs this task hourly, so users synced
        # within the last 55 minutes are skipped (55 < 60 guarantees nobody
        # misses a cycle to scheduler jitter). Effect: everyone syncs
        # roughly every 60 minutes.
        user_lst = user_lst.filter(
            Q(strava_last_synced_at__lt=timezone.now() - datetime.timedelta(minutes=55)) |
            Q(strava_last_synced_at__isnull=True)
        )
    user_lst = user_lst.order_by('strava_last_synced_at', 'pk')

    # Log pks/usernames only - email addresses are PII and shouldn't
    # land in container logs.
    user_lst_names = [{'pk': i.pk, 'username': i.username} for i in user_lst]
    print(f'Syncing Strava for {len(user_lst)} users: {user_lst_names}')

    for user in user_lst:
        try:
            sync_strava(user__id=user.id)
        except RateLimitExceeded as exc:
            sleep_time = _seconds_until_next_interval() + 60
            print(f'Strava sync rate limit exceeded - sleeping for {sleep_time // 60 } mins')
            raise self.retry(exc=exc, countdown=sleep_time)  # retry in next Strava 15min api period
        except Exception as exc:
            print(f'Strava sync failed for user {user.pk} - {exc}')

    print('Finished syncing Strava.')
    return user_lst_names



@app.task(bind=True)
def sync_strava(self, user__id, start_datetime=None):
    CustomUser = get_user_model()
    user = CustomUser.objects.get(id=user__id)

    # One activity source per user: when Garmin is the selected provider,
    # Strava must not import - the same activities would arrive twice.
    # Checked before any cache/Strava API access so it costs nothing.
    if user.get_activity_source() != 'strava':
        print(f'User {user__id} - Strava sync skipped: Strava is not the selected activity source')
        return {'user': user__id, 'skipped': 'strava is not the selected activity source'}

    access_token = cache.get(f"strava_access_token_{user__id}")

    cnt_new_strava_activities = 0
    cnt_updated_strava_activities = 0
    cnt_duplicate_strava_activities = 0

    if strava_api_monitor.ok_workout_requests() is False:
        raise RateLimitExceeded("No Strava Workout API requests allowed anymore to keep enough balance for user linkage")

    # refresh access token if expired
    if access_token is None:
        refresh_token = _get_refresh_token(user)
        from site_settings.models import resolve_strava_settings
        strava_cfg = resolve_strava_settings()
        client_id = strava_cfg["client_id"]
        client_secret = strava_cfg["client_secret"]

        response = requests.post(
            url='https://www.strava.com/oauth/token',
            data={
                'client_id': client_id,
                'client_secret': client_secret,
                'grant_type': 'refresh_token',
                'refresh_token': refresh_token,
            },
            timeout=STRAVA_HTTP_TIMEOUT,
        )
        strava_api_monitor.log_request(response)
        response.raise_for_status()

        strava_tokens = response.json()
        access_token = strava_tokens.get('access_token', None)
        cache.set(f"strava_access_token_{user__id}", access_token, int(strava_tokens.get('expires_in', 21600)) - 60)

        # Persist the (possibly rotated) refresh token encrypted at
        # rest, transparently upgrading legacy plaintext rows on their
        # first successful use.
        new_refresh_token = strava_tokens.get('refresh_token') or refresh_token
        stored = user.strava_refresh_token or ''
        if new_refresh_token and (new_refresh_token != refresh_token or not stored.startswith('gAAAAA')):
            user.strava_refresh_token = encrypt_token(new_refresh_token)
            user.save(update_fields=['strava_refresh_token'])


    # get activities
    page = 1
    per_page = 200
    while True:
        if strava_api_monitor.ok_workout_requests() is False:
            raise RateLimitExceeded("No Strava Workout API requests allowed anymore to keep enough balance for user linkage")

        response = requests.get(
            url='https://www.strava.com/api/v3/athlete/activities',
            headers={
                'Authorization': f'Bearer {access_token}',
            },
            params={
                'after': None if start_datetime is None else int(start_datetime.timestamp()),
                'page': page,
                'per_page': per_page,
            },
            timeout=STRAVA_HTTP_TIMEOUT,
        )
        strava_api_monitor.log_request(response)
        response.raise_for_status()
        activities = response.json()

        # One bulk query per page instead of one get() per activity
        # (hourly syncs re-fetched every existing row individually).
        existing_map = Workout.objects.filter(
            strava_id__in=[a.get('id') for a in activities]
        ).in_bulk(field_name='strava_id')

        for activity in activities:
            activity_id = activity.get('id')

            props = {
                'user': user,
                'strava_id': activity_id,
                'sport_type': _map_sport_type(activity.get('sport_type')),
                'start_datetime': datetime.datetime.fromisoformat(activity.get('start_date')),
                'duration': datetime.timedelta(seconds=activity.get('moving_time')),
                'distance': None if activity.get('distance') == 0 else activity.get('distance') / 1_000,
            }

            # if existing workout - update activity details
            # (existing_map is deliberately NOT scoped to the syncing
            # user: the cross-account takeover guard relies on seeing
            # other users' rows; it covers every id on this page, so no
            # separate whole-table id set is needed)
            workout = existing_map.get(activity_id)
            if workout is not None:
                # Never touch another user's workout: `strava_id` is
                # unique across the whole table, so without this guard a
                # sync would reassign (`props` contains `'user': user`)
                # a workout owned by a different account to the
                # currently syncing user - a cross-account workout
                # takeover for any duplicated/legacy Strava linkage.
                if workout.user_id == user.id:
                    for key, value in props.items():
                        setattr(workout, key, value)
                    workout.save()
                    cnt_updated_strava_activities += 1

            # if a new workout - get activity details
            else:
                # Cross-provider duplicate guard: the same activity may
                # already exist from Garmin or as a manual entry. Checked
                # before the details request so a duplicate also costs no
                # Strava API quota.
                if find_duplicate_workout(user, props['start_datetime'], props['duration'], provider='strava') is not None:
                    cnt_duplicate_strava_activities += 1
                    continue

                if strava_api_monitor.ok_workout_requests() is False:
                    raise RateLimitExceeded("No Strava Workout API requests allowed anymore to keep enough balance for user linkage")

                response = requests.get(
                    url=f'https://www.strava.com/api/v3/activities/{activity_id}',
                    headers={
                        'Authorization': f'Bearer {access_token}',
                    },
                    timeout=STRAVA_HTTP_TIMEOUT,
                )
                strava_api_monitor.log_request(response)
                response.raise_for_status()
                activity_details = response.json()

                avg_heart_rate = activity_details.get('average_heartrate', 0)
                props['kcal'] = kcal = activity_details.get('calories', activity_details.get('kilojoules', 0) / 4.18)
                props['strava_intensity_avg_watts'] = avg_watt = activity_details.get('average_watts', 0)

                # estimate intensity
                max_heart_rate = 180
                kcal_per_ten_minute = kcal / (max(activity.get('moving_time', 60 * 30), 60) / (60 * 10))
                if avg_heart_rate > max_heart_rate * 0.85 or kcal_per_ten_minute > 120 or avg_watt > 300:
                    props['intensity_category'] = 4
                elif avg_heart_rate > max_heart_rate * 0.70 or kcal_per_ten_minute > 90 or avg_watt > 275:
                    props['intensity_category'] = 3
                elif avg_heart_rate > max_heart_rate * 0.60 or kcal_per_ten_minute > 75 or avg_watt > 225:
                    props['intensity_category'] = 2
                else:
                    props['intensity_category'] = 1

                Workout.objects.create(**props)
                cnt_new_strava_activities += 1

        if len(activities) < per_page:
            break
        page += 1

    strava_last_synced_at = timezone.now()
    if start_datetime is None:
        setattr(user, 'strava_last_synced_at', strava_last_synced_at)
        user.save()
    print(f'User {user__id} - fetched {cnt_new_strava_activities} new strava activities, updated {cnt_updated_strava_activities} existing strava activities and skipped {cnt_duplicate_strava_activities} cross-provider duplicates')

    return {'user': user__id, 'total_activities': (page - 1) * per_page + len(activities), 'new_activities': cnt_new_strava_activities, 'updated_activities': cnt_updated_strava_activities, 'duplicates_skipped': cnt_duplicate_strava_activities, 'sync_time': strava_last_synced_at}
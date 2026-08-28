import datetime

from django.conf import settings
from django.apps import apps
from rest_framework.response import Response
from rest_framework import status

from django.db.models import Sum, Count, ExpressionWrapper, DurationField, F, Q, IntegerField
from django.db.models.functions import TruncDay, Now, ExtractDay


def _add_rank(data, key, enhance_dict, id_field, rank_field='rank', reverse=True):
    sorted_data = sorted(data, key=lambda x: x[key], reverse=reverse)
    rank = 0
    last_value = None
    user_lst = []
    for idx, item in enumerate(sorted_data, start=1):
        if item[key] != last_value:
            rank = idx
            last_value = item[key]
        sorted_data[idx-1] = {**item, rank_field: rank, **enhance_dict[item[id_field]]}
        enhance_dict[item[id_field]]['rank'] = rank
        enhance_dict[item[id_field]]['points'] = item[key]
        user_lst.append(item[id_field])
    for i in [i for i in enhance_dict.keys() if i not in user_lst]:
        sorted_data.append({**enhance_dict[i], rank_field: None, key: None})
        enhance_dict[i]['rank'] = None
        enhance_dict[i]['points'] = None
    return sorted_data


def _rank_map(totals):
    """Rank a {user_id: points} mapping competition-style: sorted
    descending, ties share the better rank (1, 2, 2, 4 ...)."""
    ranked = {}
    rank = 0
    last_value = None
    for idx, (uid, value) in enumerate(sorted(totals.items(), key=lambda kv: kv[1], reverse=True), start=1):
        if value != last_value:
            rank = idx
            last_value = value
        ranked[uid] = rank
    return ranked


def _compute_days_on_rank(competition_obj, timeseries_user, leaderboard_user, user_dict):
    """For how many consecutive days each participant has held their
    CURRENT rank ("on rank 1 for 12 days").

    Rebuilds the cumulative standings day by day from the daily points
    timeseries and counts backwards from the most recent day for as long
    as the user's daily rank equals today's rank. Days on which nobody
    had scored yet are skipped (an all-zero tie makes ranks meaningless -
    it neither extends nor breaks a streak). Only users with a current
    rank get an entry in the returned {user_id: days} mapping.
    """
    current_rank = {i['id']: i['rank'] for i in leaderboard_user if i.get('rank') is not None}
    if not current_rank:
        return {}

    today = datetime.date.today()
    first_day = competition_obj.start_date
    last_day = min(today, competition_obj.end_date)  # ranks freeze at the end date
    total_days = (last_day - first_day).days + 1
    if total_days <= 0:
        return {}

    member_ids = list(user_dict.keys())

    # Cumulative point totals per user per day (day 0 = competition start).
    cumulative = {}
    for uid in member_ids:
        per_day = timeseries_user.get(uid, {})
        running = 0
        totals = []
        for day_offset in range(total_days):
            days_ago = (today - (first_day + datetime.timedelta(days=day_offset))).days
            entry = per_day.get(days_ago)
            running += (entry['total'] or 0) if entry else 0
            totals.append(running)
        cumulative[uid] = totals

    # Walk backwards from the most recent day and extend each streak
    # while the daily rank matches the current one.
    still_counting = set(current_rank.keys())
    streaks = {uid: 0 for uid in still_counting}
    for day_offset in reversed(range(total_days)):
        if not still_counting:
            break
        day_totals = {uid: cumulative[uid][day_offset] for uid in member_ids}
        if all(t == 0 for t in day_totals.values()):
            continue
        ranked = _rank_map(day_totals)
        for uid in list(still_counting):
            if ranked.get(uid) == current_rank[uid]:
                streaks[uid] += 1
            else:
                still_counting.discard(uid)
    return streaks


def get_competition_stats(competition, last_seven_days=False):
    CustomUser = apps.get_model('custom_user', 'CustomUser')
    Competition = apps.get_model('competition', 'Competition')
    Points = apps.get_model('competition', 'Points')
    Team = apps.get_model('competition', 'Team')

    # Custom query logic
    try:
        competition_obj = Competition.objects.select_related('owner').prefetch_related('user', 'activitygoal_set').get(id=competition)
    except Competition.DoesNotExist:
        return Response({"detail": "Competition not found."}, status=status.HTTP_404_NOT_FOUND)
    all_points = Points.objects.filter(Q(award__competition__id=competition) | Q(goal__competition_id=competition))

    if last_seven_days:
        today = datetime.date.today()
        last_sunday = today - datetime.timedelta(days=today.weekday() + 1) if today.weekday() != 6 else today
        monday_before = last_sunday - datetime.timedelta(days=6)
        all_points = all_points.filter(workout__start_datetime__gte=monday_before, workout__start_datetime__lt=last_sunday + datetime.timedelta(days=1))

    # For SQLite
    if settings.DATABASES.get('default', {}).get('ENGINE') == 'django.db.backends.sqlite3':
        all_points_date = (
            all_points
            .annotate(date=TruncDay('workout__start_datetime'))
            .annotate(tmp_today=TruncDay(Now()))
            .annotate(tmp_start_date=TruncDay(F('workout__start_datetime')))
            .annotate(days_ago=ExpressionWrapper((F('tmp_today') - F('tmp_start_date')) / 86_400_000_000, output_field=IntegerField()))
        )
    # For Postgres
    else:
        all_points_date = (
            all_points
            .annotate(date=TruncDay('workout__start_datetime'))
            .annotate(days_ago_duration=ExpressionWrapper(TruncDay(Now()) - TruncDay(F('workout__start_datetime')), output_field=DurationField()))
            .annotate(days_ago=ExtractDay(F('days_ago_duration')))
        )
    tmp_all = (
        all_points_date
        .values('days_ago')
        .annotate(total=Sum('points_capped'))
        .values('days_ago', 'total')
        .order_by('-days_ago')
    )
    timeseries_all = {}
    for i in tmp_all:
        days_ago = i.pop('days_ago')
        timeseries_all[days_ago] = i

    tmp_user = (
        all_points_date
        .values('days_ago', 'workout__user__id')
        .annotate(total=Sum('points_capped'))
        .order_by('-days_ago')
    )
    timeseries_user = {}
    for i in tmp_user:
        user_id = i.pop('workout__user__id')
        days_ago = i.pop('days_ago')
        if user_id not in timeseries_user:
            timeseries_user[user_id] = {}
        timeseries_user[user_id][days_ago] = i

    tmp_team = (
        all_points_date
        .values('days_ago', 'workout__user__my_teams')
        .annotate(total=Sum('points_capped'))
        .order_by('-days_ago')
    )
    timeseries_team = {}
    for i in tmp_team:
        team_id = i.pop('workout__user__my_teams')
        days_ago = i.pop('days_ago')
        if team_id not in timeseries_team:
            timeseries_team[team_id] = {}
        timeseries_team[team_id][days_ago] = i

    # Get user data
    user_dict = {i['id']: i for i in CustomUser.objects.filter(my_competitions=competition).values('id', 'username', 'strava_allow_follow', 'strava_athlete_id', 'profile_picture', 'scaling_kcal', 'scaling_distance').order_by('username', 'id')}
    echo_holds = {}
    if user_dict:
        from django.db.models import Count
        from drill_instructor.echoes import LIVE_HOLDER_STATUSES
        from drill_instructor.models import LegendEcho
        echo_holds = {
            row["holder_id"]: row["n"]
            for row in (
                LegendEcho.objects.filter(
                    config__competition=competition,
                    holder_id__in=user_dict.keys(),
                    status__in=LIVE_HOLDER_STATUSES,
                )
                .values("holder_id")
                .annotate(n=Count("id"))
            )
        }
    for key, value in user_dict.items():
        if value['strava_allow_follow'] is False:
            value['strava_athlete_id'] = None
        # Profile pictures are not public: expose the authenticated
        # endpoint URL (same-origin relative path is enough - the
        # frontend fetches it with the JWT), never the raw /media/ path.
        value['profile_picture'] = f"/api/user/{value['id']}/picture/" if value['profile_picture'] else None
        value['echoes_held'] = int(echo_holds.get(key, 0))
        try:
            value['scaling_kcal'] = float(value.get('scaling_kcal') or 1)
        except (TypeError, ValueError):
            value['scaling_kcal'] = 1.0
        try:
            value['scaling_distance'] = float(value.get('scaling_distance') or 1)
        except (TypeError, ValueError):
            value['scaling_distance'] = 1.0

    # Public athlete-card extras (no email / legal name). One batch for
    # tags, one for workout counts; streak and active days come from the
    # timeseries we already built.
    tags_by_user = {}
    if user_dict:
        from drill_instructor.game import TAG_CATALOG
        from drill_instructor.models import DogTag
        for tag in DogTag.objects.filter(user_id__in=user_dict.keys()).order_by("earned_at"):
            tags_by_user.setdefault(tag.user_id, []).append({
                "slug": tag.slug,
                "title": TAG_CATALOG.get(tag.slug, {}).get("title", tag.slug),
                "blurb": TAG_CATALOG.get(tag.slug, {}).get("blurb", ""),
            })
    workout_n = {
        row["workout__user__id"]: int(row["n"])
        for row in all_points.values("workout__user__id").annotate(n=Count("workout", distinct=True))
    }
    sport_n = {}
    for row in (
        all_points.exclude(workout__sport_type="Steps")
        .values("workout__user__id", "workout__sport_type")
        .annotate(n=Count("workout", distinct=True))
    ):
        uid = row["workout__user__id"]
        sport = row["workout__sport_type"]
        if uid and sport:
            sport_n.setdefault(uid, {})[sport] = int(row["n"])

    def _day_total(per_day, days_ago):
        cell = per_day.get(days_ago)
        if cell is None:
            cell = per_day.get(str(days_ago))
        return float((cell or {}).get("total") or 0)

    def _streak(per_day):
        start = 0 if _day_total(per_day, 0) > 0 else 1
        if _day_total(per_day, start) <= 0:
            return 0
        n = 0
        d = start
        while _day_total(per_day, d) > 0 and n < 400:
            n += 1
            d += 1
        return n

    for uid, value in user_dict.items():
        days = timeseries_user.get(uid, {})
        value["dog_tags"] = tags_by_user.get(uid, [])
        value["workouts"] = int(workout_n.get(uid, 0))
        value["active_days"] = sum(1 for d in days if _day_total(days, d) > 0)
        value["streak"] = _streak(days)
        counts = sport_n.get(uid, {})
        value["sports"] = dict(sorted(counts.items(), key=lambda kv: -kv[1])[:4])

    # Get user rankings
    leaderboard_user = (
        all_points
        .values('workout__user__id')
        .annotate(total_capped=Sum('points_capped'))
        .order_by('-total_capped')
    )
    leaderboard_user = _add_rank(leaderboard_user, key="total_capped", enhance_dict=user_dict, id_field='workout__user__id')

    # "On rank N for X days" streak for every ranked participant.
    days_on_rank = _compute_days_on_rank(competition_obj, timeseries_user, leaderboard_user, user_dict)
    for entry in leaderboard_user:
        entry['days_on_rank'] = days_on_rank.get(entry['id'])

    leaderboard_user_dict = {i['id']: i for i in leaderboard_user}

    # Get team data
    team_dict = {i.id: {'id': i.id, 'name': i.name, 'members': [leaderboard_user_dict.get(i.id, {'id': i.id, 'username': 'ERROR', 'total_capped': None}) for i in i.user.all()]} for i in Team.objects.filter(competition=competition).prefetch_related('user')}
    for key, value in team_dict.items():
        value['active_member_count'] = sum(1 for i in value.get('members', []) if i.get('total_capped', 0) is not None and i.get('total_capped', 0) > 0)
        value['member_count'] = len(value.get('members', []))

    # Get team rankings
    leaderboard_team = (
        all_points
        .values('workout__user__my_teams__id')
        .annotate(total_capped=Sum('points_capped'))
        .order_by('-total_capped')
    )
    leaderboard_team = [{**i, 'total_capped': i['total_capped'] / max(1, team_dict[i['workout__user__my_teams__id']]['active_member_count'])} for i in leaderboard_team if i['workout__user__my_teams__id'] in team_dict]
    leaderboard_team = _add_rank(leaderboard_team, key="total_capped", enhance_dict=team_dict, id_field='workout__user__my_teams__id')
    team_dict = {i['id']: i for i in leaderboard_team}

    # One query for the member ids - not two (values_list + count).
    member_pks = list(competition_obj.user.all().values_list('pk', flat=True))
    competition_details = {
        'name': competition_obj.name,
        'owner': user_dict.get(competition_obj.owner.pk, {'id': competition_obj.owner.pk, 'username': 'ERROR', 'total_capped': None}),
        'members': [user_dict.get(i, {'id': i, 'username': 'ERROR', 'total_capped': None}) for i in member_pks],
        'member_count': len(member_pks),
        'active_member_count': len(timeseries_user),
        'start_date': competition_obj.start_date,
        'start_date_count': (datetime.date.today() - competition_obj.start_date).days,
        'end_date': competition_obj.end_date,
        'end_date_count': (datetime.date.today() - competition_obj.end_date).days,
        'has_teams': competition_obj.has_teams,
        'goals': competition_obj.activitygoal_set.all().values(),
    }

    response_obj = {
        'competition': competition_details,
        'users': user_dict,
        'teams': team_dict,
        'timeseries': {
            'all': timeseries_all,
            'user': timeseries_user,
            'team': timeseries_team,
        },
        'leaderboard': {
            'team': leaderboard_team,
            'individual': leaderboard_user,
        }
    }
    return response_obj


def get_competition_rank_summary(competition_id, user_id):
    """Tiny Home payload: my rank / team rank, not the season snapshot."""
    Competition = apps.get_model("competition", "Competition")
    Points = apps.get_model("competition", "Points")
    Team = apps.get_model("competition", "Team")
    try:
        comp = Competition.objects.only("start_date", "has_teams").get(pk=competition_id)
    except Competition.DoesNotExist:
        return None
    totals = list(
        Points.objects.filter(Q(award__competition_id=competition_id) | Q(goal__competition_id=competition_id))
        .values("workout__user")
        .annotate(total=Sum("points_capped"))
        .order_by("-total")
    )
    my_rank = None
    my_points = 0.0
    rank = 0
    last = None
    for idx, row in enumerate(totals, start=1):
        if row["total"] != last:
            rank = idx
            last = row["total"]
        if row["workout__user"] == user_id:
            my_rank = rank
            my_points = float(row["total"] or 0)
            break
    team_rank = None
    if comp.has_teams:
        team = Team.objects.filter(competition_id=competition_id, user__id=user_id).first()
        if team is not None:
            team_totals = []
            for t in Team.objects.filter(competition_id=competition_id).prefetch_related("user"):
                member_ids = {u.id for u in t.user.all()}
                pts = sum(float(r["total"] or 0) for r in totals if r["workout__user"] in member_ids)
                active = sum(1 for r in totals if r["workout__user"] in member_ids and (r["total"] or 0) > 0)
                team_totals.append((t.id, pts / max(1, active)))
            team_totals.sort(key=lambda x: -x[1])
            tr = 0
            last_v = None
            for idx, (tid, val) in enumerate(team_totals, start=1):
                if val != last_v:
                    tr = idx
                    last_v = val
                if tid == team.id:
                    team_rank = tr
                    break
    start_count = (datetime.date.today() - comp.start_date).days
    return {
        "my_rank": my_rank,
        "my_points": my_points,
        "team_rank": team_rank,
        "started": start_count >= 0,
        "start_date_count": start_count,
        "has_teams": comp.has_teams,
    }

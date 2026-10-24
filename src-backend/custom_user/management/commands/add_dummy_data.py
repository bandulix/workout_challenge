from django.core.management import BaseCommand, CommandError
from django.conf import settings
import random
from datetime import date, datetime, timedelta

from competition.models import Competition, ActivityGoal, Team, Award
from workouts.models import Workout
from custom_user.models import CustomUser


class Command(BaseCommand):
    """Add additional test data"""

    # Show this when the user types help
    help = "Adds test data"

    def handle(self, *args, **options):
        """Actual Commandline executed function when manage.py command is called"""
        # This command creates superusers with the password "password" -
        # it must never run against a production deployment.
        if not settings.DEBUG:
            raise CommandError("add_dummy_data is a development tool and refuses to run with DEBUG=false.")

        # Competition.save() concatenates end_date with a timedelta when
        # seeding default goals — pass real date objects, not ISO strings.
        today = date.today()
        who_start = date(today.year, 1, 1)
        who_end = date(today.year, 12, 31)
        distance_start = date(today.year, 1, 1)
        distance_end = date(today.year, 12, 31)

        test_users = [
            {
                "email": "user1@admin.local",
                "password": "password",
                "first_name": "Charlotte",
                "last_name": "Doe",
                "is_superuser": True,
                "is_staff": True,
                "strava_athlete_id": 123456789,
            },
            {
                "email": "user2@admin.local",
                "password": "password",
                "first_name": "Tom",
                "last_name": "Smith-Bloggs",
                "is_superuser": True,
                "is_staff": True,
            },
            {
                "email": "user3@admin.local",
                "password": "password",
                "first_name": "User",
                "last_name": "von der Leyen",
                "is_superuser": False,
                "is_staff": False,
            },
        ]

        user_obj_dict = {}
        for user_i in test_users:
            existing = CustomUser.objects.filter(email=user_i["email"]).first()
            if existing:
                user_obj_dict[user_i["email"]] = existing
                self.stdout.write(f"User already exists: {user_i['email']}")
                continue
            user_obj = CustomUser.objects.create_user(**user_i)
            user_obj.set_password(user_i["password"])
            user_obj.is_verified = True
            user_obj.save()
            user_obj_dict[user_i["email"]] = user_obj

        # Competition normalises join_code to uppercase on save.
        if Competition.objects.filter(join_code__iexact="WHOComp").exists():
            self.stdout.write("Demo competitions already seeded — skipping.")
            _seed_readiness(self.stdout)
            self.stdout.write(
                "Sign in with user1@admin.local / password (or user2 / user3)."
            )
            return

        test_competitions = [
            {
                "owner": CustomUser.objects.get(email="user1@admin.local"),
                "name": "WHO Competition",
                "join_code": "WHOComp",
                "start_date": who_start,
                "end_date": who_end,
                "has_teams": True,
                "teams": [
                    {
                        "name": "Team 1",
                        "members": [
                            "user1@admin.local",
                            "user2@admin.local",
                        ]
                    }
                ],
                "goals": [
                    {
                        "name": "Move",
                        "metric": "kcal",
                        "period": "week",
                        "goal": 600,
                        "max_per_day": 1_200,
                        "max_per_week": 6_000,  # 5x the daily limit
                    },
                    {
                        "name": "Exercise",
                        "metric": "min",
                        "period": "day",
                        "goal": 30,
                        "max_per_day": 60,
                        "max_per_week": 300,  # 5x the daily limit
                    },
                ],
                "awards": [
                    {
                        "name": "10 Workouts (Bronze)",
                        "sport": "GROUP_ANY",
                        "threshold": 10,
                        "period": "end",
                        "reward_points": 250,
                    },
                    {
                        "name": "25 Workouts (Silver)",
                        "sport": "GROUP_ANY",
                        "threshold": 25,
                        "period": "end",
                        "reward_points": 500,
                    },
                    {
                        "name": "50 Workouts (Gold)",
                        "sport": "GROUP_ANY",
                        "threshold": 25,
                        "period": "end",
                        "reward_points": 1_000,
                    },
                ]
            },
            {
                "owner": CustomUser.objects.get(email="user2@admin.local"),
                "name": "100k 1k Competition",
                "join_code": "100k1k",
                "start_date": distance_start,
                "end_date": distance_end,
                "teams": [
                    {
                        "name": "Team 1",
                        "members": [
                            "user3@admin.local",
                            "user2@admin.local",
                        ]
                    }
                ],
                "goals": [
                    {
                        "name": "Distance",
                        "metric": "km",
                        "period": "competition",
                        "goal": 1_000,
                        "min_per_workout": 5,
                    },
                    {
                        "name": "Effort",
                        "metric": "kj",
                        "period": "month",
                        "goal": 1_000,
                    },
                    {
                        "name": "Workouts",
                        "metric": "num",
                        "period": "week",
                        "goal": 3,
                        "max_per_day": 2,
                        "max_per_week": 6,
                    },
                ]
            }
        ]


        for competitions_i in test_competitions:
            goals = competitions_i.pop("goals", [])
            awards = competitions_i.pop("awards", [])
            teams = competitions_i.pop("teams", [])
            competitions_obj = Competition(**competitions_i)
            competitions_obj.save()

            for goal_i in goals:
                goal_obj = ActivityGoal(competition=competitions_obj, **goal_i)
                goal_obj.save()

            for award_i in awards:
                award_obj = Award(competition=competitions_obj, **award_i)
                award_obj.save()

            for team_i in teams:
                team_i_name = team_i.pop("name")
                team_i_members = team_i.pop("members", [])
                team_obj = Team(competition=competitions_obj, name=team_i_name)
                team_obj.save()
                for user_i in team_i_members:
                    user_i_obj = CustomUser.objects.get(email=user_i)
                    user_i_obj.my_teams.add(team_obj)
                    user_i_obj.my_competitions.add(competitions_obj)
                    user_i_obj.save()


        test_workouts = []
        now = datetime.now()
        curr_datetime = now - timedelta(days=30 * 6)  # 6 months ago
        while curr_datetime < now:
            today_entries = random.randint(0, len(test_users))
            user_entries = random.sample(test_users, k=today_entries)
            for user_i in user_entries:
                duration_i = random.randint(15, 75)
                sport_i = random.sample(['Run', 'Tennis', 'WeightTraining', 'Workout'], k=1)[0]

                workout_i = {
                        'user': user_i['email'],
                        'sport_type': sport_i,
                        'start_datetime': curr_datetime,
                        'duration': timedelta(minutes=duration_i),
                        'intensity_category': random.sample([1, 2, 3, 4], k=1)[0],
                        'kcal': random.uniform(0.6, 1.3) * 10 * duration_i,
                        'distance': duration_i / random.uniform(5, 8) if sport_i == 'Run' else None,
                        'strava_id': random.randint(0, 999999999) if random.sample([True, False], k=1)[0] else None,
                }

                test_workouts.append({**workout_i})
                curr_datetime += timedelta(minutes=random.uniform(2, 4) * 60 * 24)

        for workout_i in test_workouts:
            user_email = workout_i.pop("user", None)
            user = CustomUser.objects.get(email=user_email)
            workout_obj = Workout(user=user, **workout_i)
            workout_obj.save()

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {len(user_obj_dict)} users, "
            f"{Competition.objects.count()} competitions, "
            f"{Workout.objects.count()} workouts."
        ))
        _seed_readiness(self.stdout)
        self.stdout.write("Sign in with user1@admin.local / password (or user2 / user3).")


def _seed_readiness(stdout):
    """Green / Amber / Red demo mornings. Daily aggregates only.

    Runs on a fresh seed and again when the competitions already exist,
    so a second `add_dummy_data` still fills readiness.
    """
    from zoneinfo import ZoneInfo

    from django.utils import timezone

    from drill_instructor.models import DrillInstructorConfig, DrillInstructorPersona
    from readiness.models import AthleteOrder, RecoveryDay, RecoveryPreference
    from readiness.service import refresh_athlete

    persona = DrillInstructorPersona.objects.filter(name="Drill Sergeant").first()
    who = Competition.objects.filter(join_code__iexact="WHOComp").first()
    distance = Competition.objects.filter(join_code__iexact="100k1k").first()
    for competition in (who, distance):
        if competition is None or persona is None:
            continue
        config = DrillInstructorConfig.objects.filter(competition=competition).first()
        if config is None:
            DrillInstructorConfig.objects.create(
                competition=competition, persona=persona, enabled=True,
            )
        elif not config.enabled:
            config.enabled = True
            config.save(update_fields=["enabled"])

    zone = ZoneInfo("Europe/London")
    today = timezone.now().astimezone(zone).date()
    scopes = ["sleep", "hrv", "resting_hr", "body_battery", "training_readiness", "stress"]
    profiles = {
        "user1@admin.local": {
            "hrv": 60, "hrv_today": 72, "sleep": 450, "sleep_today": 480,
            "rhr": 52, "rhr_today": 48,
            "voice": "Push day. You are fresh. Stretch it, or beat the mark if one is live.",
        },
        "user2@admin.local": {
            "hrv": 55, "hrv_today": 46, "sleep": 450, "sleep_today": 340,
            "rhr": 50, "rhr_today": 54,
            "voice": "Moderate day. Thirty steady minutes. Technique over power.",
        },
        "user3@admin.local": {
            "hrv": 50, "hrv_today": 28, "sleep": 450, "sleep_today": 280,
            "rhr": 50, "rhr_today": 62,
            "voice": "Recovery day. A walk, some mobility, or an easy spin. Protect the streak.",
        },
    }
    for email, profile in profiles.items():
        user = CustomUser.objects.filter(email=email).first()
        if user is None:
            continue
        RecoveryPreference.objects.update_or_create(
            user=user,
            defaults={
                "opted_in": True,
                "consent_version": "1",
                "consented_at": timezone.now(),
                "scopes": scopes,
                "timezone": "Europe/London",
                "morning_push_enabled": False,
                "quiet_start_minute": 22 * 60,
                "quiet_end_minute": 7 * 60,
            },
        )
        for offset in range(1, 15):
            day = today - timedelta(days=offset)
            RecoveryDay.objects.update_or_create(
                user=user,
                date=day,
                defaults={
                    "source": RecoveryDay.SOURCE_GARMIN,
                    "sleep_minutes": profile["sleep"],
                    "hrv_ms": profile["hrv"],
                    "hrv_metric": "rmssd",
                    "resting_hr": profile["rhr"],
                },
            )
        RecoveryDay.objects.update_or_create(
            user=user,
            date=today,
            defaults={
                "source": RecoveryDay.SOURCE_GARMIN,
                "sleep_minutes": profile["sleep_today"],
                "hrv_ms": profile["hrv_today"],
                "hrv_metric": "rmssd",
                "resting_hr": profile["rhr_today"],
            },
        )
        _snapshot, orders = refresh_athlete(user, with_voice=False, today=today)
        AthleteOrder.objects.filter(user=user, date=today).update(voice=profile["voice"])
        stdout.write(
            f"Readiness {email}: {(_snapshot.band or 'warming')} {_snapshot.score} — {_snapshot.why} "
            f"({len(orders)} orders)"
        )


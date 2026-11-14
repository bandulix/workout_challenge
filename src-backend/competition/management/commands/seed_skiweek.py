"""A future Zermatt ski week for countdown screenshots. DEBUG only."""

import datetime
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from competition.models import Competition, SkiWeekCampaign, SkiWeekTeaser
from competition.skiweek import fallback_teaser
from custom_user.models import CustomUser
from drill_instructor.models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona


CREW = (
    ("lena@skiweek.demo", "Lena"),
    ("mats@skiweek.demo", "Mats"),
    ("noor@skiweek.demo", "Noor"),
    ("jules@skiweek.demo", "Jules"),
)


class Command(BaseCommand):
    help = "Seed a pre-start Zermatt ski week with snow, a coach line, and four athletes."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_skiweek refuses to run with DEBUG=false.")
        users = []
        for email, first in CREW:
            user, created = CustomUser.objects.get_or_create(
                email=email,
                defaults={"first_name": first, "last_name": ""},
            )
            if created:
                user.set_password("skiweek-demo")
            user.first_name = first
            user.is_verified = True
            user.save()
            users.append(user)

        start = timezone.localdate() + datetime.timedelta(days=2)
        end = start + datetime.timedelta(days=6)
        owner = users[0]
        competition = Competition.objects.filter(owner=owner, name="Skiwoche Zermatt").first()
        if competition is None:
            competition = Competition.objects.create(
                owner=owner, name="Skiwoche Zermatt", start_date=start, end_date=end, has_teams=True,
            )
        else:
            competition.start_date = start
            competition.end_date = end
            competition.has_teams = True
            competition.save()
        for user in users:
            user.my_competitions.add(competition)

        snapshot = {
            "available": True,
            "mood": "snowing",
            "is_snowing": True,
            "fresh_snow_cm": 14,
            "snowfall_24h_cm": 14,
            "snowfall_72h_cm": 31,
            "attribution": "Weather and snow: Open-Meteo.com",
            "source": "Open-Meteo",
            "current": {
                "temperature_c": -6.4,
                "summit_temperature_c": -14.2,
                "weather_code": 71,
                "label": "Snow",
                "snowfall_cm": 0.4,
                "freezing_level_m": 1480,
                "snow_valley_cm": 86,
                "snow_summit_cm": 168,
            },
            "daily": [
                {"date": start.isoformat(), "label": "Snow", "weather_code": 71, "temp_max_c": -2, "temp_min_c": -9, "snowfall_cm": 8},
                {"date": (start + datetime.timedelta(days=1)).isoformat(), "label": "Snow", "weather_code": 73, "temp_max_c": -3, "temp_min_c": -11, "snowfall_cm": 11},
                {"date": (start + datetime.timedelta(days=2)).isoformat(), "label": "Clouds", "weather_code": 3, "temp_max_c": -1, "temp_min_c": -7, "snowfall_cm": 1},
            ],
        }
        campaign, _created = SkiWeekCampaign.objects.get_or_create(
            competition=competition,
            defaults={"enabled": True},
        )
        campaign.enabled = True
        campaign.resort_slug = "zermatt"
        campaign.resort_name = "Zermatt"
        campaign.latitude = Decimal("46.02071")
        campaign.longitude = Decimal("7.74913")
        campaign.summit_elevation_m = 3883
        campaign.valley_elevation_m = 1620
        campaign.timezone = "Europe/Zurich"
        campaign.day_cutoff_hour = 5
        campaign.water_enabled = True
        campaign.points_per_sambuca = Decimal("5.00")
        campaign.weather_snapshot = snapshot
        campaign.save()

        persona, _created = DrillInstructorPersona.objects.get_or_create(
            name="Alpine Coach",
            defaults={
                "system_prompt": "Dry, short, in love with weather and ridges. Never mention alcohol.",
                "tagline": "The mountain first.",
                "avatar": "zen",
                "language": "en",
            },
        )
        config, _created = DrillInstructorConfig.objects.get_or_create(
            competition=competition,
            defaults={"persona": persona, "enabled": True, "send_push_on_activity": False},
        )
        config.persona = persona
        config.enabled = True
        config.save()

        weather = {**snapshot, "opening_days": snapshot["daily"]}
        body = fallback_teaser("d3", "Zermatt", weather)
        teaser, _created = SkiWeekTeaser.objects.get_or_create(
            campaign=campaign,
            milestone="d3",
            defaults={"body": body, "source": "fallback"},
        )
        teaser.body = body
        teaser.save()
        if not DrillInstructorMessage.objects.filter(config=config, kind=DrillInstructorMessage.KIND_SKIWEEK).exists():
            DrillInstructorMessage.objects.create(
                config=config, kind=DrillInstructorMessage.KIND_SKIWEEK, body=body, posted_at=timezone.now(),
            )

        self.stdout.write(f"competition={competition.pk}")
        self.stdout.write("login lena@skiweek.demo / skiweek-demo")

"""Two Zermatt ski weeks for screenshots: one counting down, one already skiing.

DEBUG only. Weather is locked to the same snow report on both, so the
coach line and the card cannot drift apart.
"""

import datetime
from decimal import Decimal
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from PIL import Image, ImageDraw

from competition.models import Competition, SambucaEntry, SkiWeekCampaign, SkiWeekTeaser
from competition.skiweek import fallback_teaser, log_sip, settle_due_crowns
from custom_user.models import CustomUser
from drill_instructor.models import DrillInstructorConfig, DrillInstructorPersona
from workouts.models import Workout

CREW = (
    ("lena@skiweek.demo", "Lena", (232, 184, 74)),
    ("mats@skiweek.demo", "Mats", (155, 231, 255)),
    ("noor@skiweek.demo", "Noor", (180, 140, 255)),
    ("jules@skiweek.demo", "Jules", (255, 160, 120)),
)

SNOW = {
    "lock": True,
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
        "snowfall_cm": 0.4,
        "freezing_level_m": 1480,
        "snow_valley_cm": 86,
        "snow_summit_cm": 168,
    },
}


def _portrait(initial, color):
    image = Image.new("RGB", (128, 128), color)
    draw = ImageDraw.Draw(image)
    draw.ellipse((8, 8, 120, 120), fill=(11, 11, 12))
    draw.text((48, 46), initial, fill=color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return ContentFile(buffer.getvalue())


def _snow_for(start):
    payload = {
        **SNOW,
        "current": dict(SNOW["current"]),
        "daily": [
            {"date": (start + datetime.timedelta(days=offset)).isoformat(), "weather_code": code, "temp_max_c": high, "temp_min_c": low, "snowfall_cm": snow}
            for offset, code, high, low, snow in (
                (0, 71, -2, -9, 8),
                (1, 73, -3, -11, 11),
                (2, 3, -1, -7, 1),
            )
        ],
    }
    return payload


class Command(BaseCommand):
    help = "Seed a countdown ski week and a live one with the same snow report."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_skiweek refuses to run with DEBUG=false.")
        users = []
        for email, first, color in CREW:
            user, created = CustomUser.objects.get_or_create(email=email, defaults={"first_name": first})
            if created or not user.has_usable_password():
                user.set_password("skiweek-demo")
            user.first_name = first
            user.is_verified = True
            user.save()
            if not user.profile_picture:
                user.profile_picture.save(f"{first.lower()}.png", _portrait(first[0], color), save=True)
            users.append(user)

        persona, _created = DrillInstructorPersona.objects.get_or_create(
            name="Alpine Coach",
            defaults={
                "system_prompt": "Dry, short, fond of ridges. One image, not a list. Never mention alcohol.",
                "tagline": "The mountain first.",
                "avatar": "zen",
                "language": "en",
            },
        )
        persona.language = "en"
        persona.save(update_fields=["language"])

        today = timezone.localdate()
        countdown_id = self._week(
            users, persona, "Skiwoche Zermatt", today + datetime.timedelta(days=2), today + datetime.timedelta(days=8),
            live=False,
        )
        finale_id = self._week(
            users, persona, "Skiwoche Finale", today - datetime.timedelta(days=10), today - datetime.timedelta(days=1),
            live=True,
        )
        live_id = self._week(
            users, persona, "Skiwoche Live", today - datetime.timedelta(days=3), today + datetime.timedelta(days=3),
            live=True,
        )
        self.stdout.write(f"countdown={countdown_id}")
        self.stdout.write(f"finale={finale_id}")
        self.stdout.write(f"live={live_id}")
        self.stdout.write("login lena@skiweek.demo / skiweek-demo")

    def _week(self, users, persona, name, start, end, *, live):
        owner = users[0]
        competition = Competition.objects.filter(owner=owner, name=name).first()
        if competition is None:
            competition = Competition.objects.create(
                owner=owner, name=name, start_date=start, end_date=end, has_teams=True,
            )
        else:
            competition.start_date = start
            competition.end_date = end
            competition.save()
        for user in users:
            user.my_competitions.add(competition)
        campaign, _created = SkiWeekCampaign.objects.get_or_create(competition=competition, defaults={"enabled": True})
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
        campaign.weather_snapshot = _snow_for(start)
        campaign.save()
        config, _created = DrillInstructorConfig.objects.get_or_create(
            competition=competition,
            defaults={"persona": persona, "enabled": True, "send_push_on_activity": False},
        )
        config.persona = persona
        config.enabled = True
        config.save()
        if live:
            self._live_activity(campaign, users)
        else:
            SkiWeekTeaser.objects.filter(campaign=campaign).delete()
            days = (start - timezone.localdate()).days
            body = fallback_teaser("preview", "Zermatt", {**campaign.weather_snapshot, "opening_days": campaign.weather_snapshot["daily"]}, days=days, language="en")
            SkiWeekTeaser.objects.create(campaign=campaign, milestone="preview", body=body, source="fallback")
        return competition.pk

    def _live_activity(self, campaign, users):
        lena, mats, noor, jules = users
        window_start, window_end = datetime.datetime.combine(campaign.competition.start_date, datetime.time.min, tzinfo=datetime.timezone.utc), datetime.datetime.combine(campaign.competition.end_date + datetime.timedelta(days=1), datetime.time.min, tzinfo=datetime.timezone.utc)
        Workout.objects.filter(
            user__in=users, sport_type__in=("AlpineSki", "Snowboard", "BackcountrySki"),
            start_datetime__gte=window_start, start_datetime__lt=window_end,
        ).delete()
        SambucaEntry.objects.filter(campaign=campaign).delete()
        from competition.models import SambucaCrown, SambucaSettlement
        SambucaCrown.objects.filter(settlement__campaign=campaign).delete()
        SambucaSettlement.objects.filter(campaign=campaign).delete()
        from competition.models import SkiPhotoCard
        from drill_instructor.models import DrillInstructorMessage
        posted = list(SkiPhotoCard.objects.filter(campaign=campaign).exclude(message_id=None).values_list("message_id", flat=True))
        DrillInstructorMessage.objects.filter(pk__in=posted).delete()
        SkiPhotoCard.objects.filter(campaign=campaign).delete()
        start = campaign.competition.start_date
        plan = (
            (lena, "AlpineSki", 0, 11, 1860, "28.4"),
            (mats, "Snowboard", 0, 9, 1420, "22.1"),
            (noor, "AlpineSki", 1, 14, 2100, "31.0"),
            (jules, "BackcountrySki", 1, 6, 980, "12.4"),
            (lena, "AlpineSki", 2, 8, 1240, "18.6"),
            (mats, "AlpineSki", 2, 12, 1760, "26.2"),
        )
        today_offset = (timezone.localdate() - start).days
        if 0 <= today_offset <= (campaign.competition.end_date - start).days:
            plan = plan + (
                (lena, "AlpineSki", today_offset, 7, 1540, "19.5"),
                (noor, "Snowboard", today_offset, 5, 880, "14.2"),
            )
        for user, sport, offset, runs, elevation, distance in plan:
            when = datetime.datetime.combine(start + datetime.timedelta(days=offset), datetime.time(10, 0), tzinfo=datetime.timezone.utc)
            Workout.objects.create(
                user=user, sport_type=sport, start_datetime=when,
                duration=datetime.timedelta(hours=4), intensity_category=3,
                distance=Decimal(distance), elevation_m=Decimal(elevation), runs=runs,
            )
        # Resort day of the first ski day: a shared crown.
        tie_evening = datetime.datetime.combine(start, datetime.time(20, 0), tzinfo=datetime.timezone.utc)
        log_sip(campaign, lena, amount=3, when=tie_evening)
        log_sip(campaign, mats, amount=3, when=tie_evening)
        log_sip(campaign, noor, amount=1, when=tie_evening)
        yesterday = timezone.localdate() - datetime.timedelta(days=1)
        if campaign.competition.start_date <= yesterday <= campaign.competition.end_date:
            tie_yesterday = datetime.datetime.combine(yesterday, datetime.time(20, 0), tzinfo=datetime.timezone.utc)
            log_sip(campaign, lena, amount=3, when=tie_yesterday)
            log_sip(campaign, mats, amount=3, when=tie_yesterday)
        later = datetime.datetime.combine(start + datetime.timedelta(days=1), datetime.time(21, 0), tzinfo=datetime.timezone.utc)
        log_sip(campaign, jules, amount=2, when=later)
        log_sip(campaign, noor, amount=2, when=later)
        today_evening = timezone.now().replace(hour=18, minute=0, second=0, microsecond=0)
        if today_evening.date() <= campaign.competition.end_date:
            log_sip(campaign, lena, amount=2, when=today_evening)
            log_sip(campaign, mats, amount=1, when=today_evening)
        settle_due_crowns(now=timezone.now())
        self._demo_cards(campaign, users)

    def _demo_cards(self, campaign, users):
        from io import BytesIO

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image, ImageDraw

        from competition.ski_photos import create_card

        lena, mats = users[0], users[1]

        def paint(kind, paths, prompt):
            img = Image.new("RGB", (720, 900), (10, 18, 32))
            draw = ImageDraw.Draw(img)
            draw.rectangle([18, 18, 702, 882], outline=(232, 184, 74), width=4)
            draw.rectangle([36, 520, 684, 860], fill=(28, 22, 16))
            if kind == "split":
                draw.line([(360, 36), (360, 860)], fill=(155, 231, 255), width=3)
            try:
                with Image.open(paths[0]) as src:
                    src = src.convert("RGB").resize((280, 280))
                    img.paste(src, (80, 140))
                if len(paths) > 1:
                    with Image.open(paths[1]) as src:
                        src = src.convert("RGB").resize((280, 280))
                        img.paste(src, (380, 140))
            except Exception:
                pass
            draw.text((48, 48), kind, fill=(155, 231, 255))
            buf = BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()

        def shot(user, name):
            try:
                user.profile_picture.open("rb")
                data = user.profile_picture.read()
                user.profile_picture.close()
            except Exception:
                color = next(item[2] for item in CREW if item[1] == user.first_name)
                data = _portrait(user.first_name[:1], color).read()
            return SimpleUploadedFile(name, data, content_type="image/png")

        yesterday = timezone.localdate() - datetime.timedelta(days=1)
        create_card(
            campaign, "coronation", [lena, mats], [shot(lena, "lena.png"), shot(mats, "mats.png")],
            day=yesterday, editor=paint, writer=lambda *args: None, post=False,
        )
        today = timezone.localdate()
        create_card(
            campaign, "hut", [lena], [shot(lena, "hut.png")],
            day=today, editor=paint,
            writer=lambda *args: "The fire is going at Zermatt. Snow on the glass.",
        )
        create_card(
            campaign, "split", [lena], [shot(lena, "slope.png"), shot(mats, "evening.png")],
            day=today, editor=paint,
            writer=lambda *args: "Slope, then evening. Zermatt in two moods.",
            post=False,
        )

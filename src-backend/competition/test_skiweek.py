"""Ski week: resort days, shared crowns, Sambuca points, snow."""

import base64
import datetime
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from custom_user.models import CustomUser
from workouts.metrics import optional_activity_metrics
from workouts.models import Workout
from .models import Competition, Points, SambucaCrown, SambucaEntry, SambucaSettlement, SkiWeekCampaign, SkiWeekTeaser
from .resorts import ResortError, geocode_alpine, resolve_resort
from .skiweek import (
    KIND_WATER,
    compose_teaser,
    fetch_weather,
    log_sip,
    milestone_for,
    phase_of,
    post_teaser_if_due,
    resort_day,
    settle_due_crowns,
    undo_last_sip,
    weather_for_campaign,
)
from .stats import get_competition_rank_summary, get_competition_stats

ZURICH = ZoneInfo("Europe/Zurich")
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _at(day, hour, minute=0):
    return datetime.datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZURICH)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class SkiWeekDomainTests(TestCase):
    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.owner = CustomUser.objects.create_user(email="lena@ski.test", password="test-pw", first_name="Lena")
        self.mats = CustomUser.objects.create_user(email="mats@ski.test", password="test-pw", first_name="Mats")
        self.noor = CustomUser.objects.create_user(email="noor@ski.test", password="test-pw", first_name="Noor")
        self.start = datetime.date(2026, 2, 8)
        self.end = datetime.date(2026, 2, 14)
        self.competition = Competition.objects.create(
            owner=self.owner, name="Skiwoche", start_date=self.start, end_date=self.end, has_teams=True,
        )
        self.mats.my_competitions.add(self.competition)
        self.noor.my_competitions.add(self.competition)
        self.campaign = SkiWeekCampaign.objects.create(
            competition=self.competition,
            enabled=True,
            resort_slug="zermatt",
            resort_name="Zermatt",
            latitude=Decimal("46.02071"),
            longitude=Decimal("7.74913"),
            summit_elevation_m=3883,
            valley_elevation_m=1620,
            timezone="Europe/Zurich",
            day_cutoff_hour=5,
            water_enabled=True,
            points_per_sambuca=Decimal("5.00"),
        )

    def test_cutoff_keeps_late_apres_on_the_previous_resort_day(self):
        self.assertEqual(resort_day(_at(datetime.date(2026, 2, 10), 4, 59), "Europe/Zurich", 5), datetime.date(2026, 2, 9))
        self.assertEqual(resort_day(_at(datetime.date(2026, 2, 10), 5, 0), "Europe/Zurich", 5), datetime.date(2026, 2, 10))

    def test_tie_shares_the_crown_and_a_lower_total_does_not(self):
        evening = _at(datetime.date(2026, 2, 9), 21)
        log_sip(self.campaign, self.owner, amount=2, when=evening)
        log_sip(self.campaign, self.mats, amount=2, when=evening)
        log_sip(self.campaign, self.noor, amount=1, when=evening)
        self.assertFalse(SambucaSettlement.objects.filter(campaign=self.campaign).exists())

        result = settle_due_crowns(now=_at(datetime.date(2026, 2, 10), 6))
        self.assertEqual(result["settled"], 2)  # Feb 8 empty + Feb 9 crowned
        settlement = SambucaSettlement.objects.get(campaign=self.campaign, resort_day=datetime.date(2026, 2, 9))
        self.assertEqual(settlement.winning_count, 2)
        wearers = set(SambucaCrown.objects.filter(settlement=settlement).values_list("user_id", flat=True))
        self.assertEqual(wearers, {self.owner.id, self.mats.id})
        again = settle_due_crowns(now=_at(datetime.date(2026, 2, 10), 8))
        self.assertEqual(again["settled"], 0)
        self.assertEqual(SambucaCrown.objects.filter(settlement=settlement).count(), 2)

    def test_sambuca_points_are_separate_from_piste_points(self):
        Workout.objects.create(
            user=self.owner,
            sport_type="AlpineSki",
            start_datetime=_at(datetime.date(2026, 2, 9), 10),
            duration=datetime.timedelta(minutes=90),
            intensity_category=3,
            distance=Decimal("24.5"),
            elevation_m=Decimal("1860.0"),
            runs=11,
        )
        log_sip(self.campaign, self.owner, amount=2, when=_at(datetime.date(2026, 2, 9), 18))
        log_sip(self.campaign, self.noor, amount=1, kind=KIND_WATER, when=_at(datetime.date(2026, 2, 9), 12))
        piste = float(Points.objects.filter(workout__user=self.owner).aggregate(total=__import__("django.db.models", fromlist=["Sum"]).Sum("points_capped"))["total"] or 0)
        self.assertGreater(piste, 0)

        stats = get_competition_stats(self.competition.id)
        owner = next(row for row in stats["leaderboard"]["individual"] if row["id"] == self.owner.id)
        noor = next(row for row in stats["leaderboard"]["individual"] if row["id"] == self.noor.id)
        self.assertEqual(owner["sambuca_points"], 10.0)
        self.assertEqual(owner["piste_points"], round(piste, 2))
        self.assertEqual(owner["total_capped"], round(piste, 2) + 10.0)
        labels = [item["label"] for item in owner["points_breakdown"]]
        self.assertEqual(labels, ["Piste", "Sambuca"])
        self.assertEqual(noor["sambuca_points"], 0.0)
        self.assertIn(noor["total_capped"], (None, 0, 0.0))

        summary = get_competition_rank_summary(self.competition.id, self.owner.id, track_gap_change=False)
        self.assertEqual(summary["my_sambuca_points"], 10.0)
        self.assertEqual(summary["my_points"], summary["my_piste_points"] + 10.0)

    def test_points_per_sambuca_is_configurable_and_undo_removes_them(self):
        self.campaign.points_per_sambuca = Decimal("8.00")
        self.campaign.save(update_fields=["points_per_sambuca"])
        log_sip(self.campaign, self.mats, amount=1, when=_at(datetime.date(2026, 2, 10), 19))
        stats = get_competition_stats(self.competition.id)
        mats = next(row for row in stats["leaderboard"]["individual"] if row["id"] == self.mats.id)
        self.assertEqual(mats["sambuca_points"], 8.0)
        self.assertEqual(mats["piste_points"], 0.0)
        undo_last_sip(self.campaign, self.mats)
        stats = get_competition_stats(self.competition.id)
        mats = next(row for row in stats["leaderboard"]["individual"] if row["id"] == self.mats.id)
        self.assertTrue(mats.get("sambuca_points") in (0, 0.0, None) or mats["total_capped"] in (None, 0, 0.0))

    def test_soft_confirm_is_not_a_hard_block(self):
        when = _at(datetime.date(2026, 2, 11), 22)
        from .skiweek import SkiWeekError
        for _ in range(2):
            log_sip(self.campaign, self.owner, amount=3, when=when)
        with self.assertRaises(SkiWeekError) as raised:
            log_sip(self.campaign, self.owner, amount=3, when=when)
        self.assertEqual(raised.exception.code, "confirm_sambuca")
        self.assertEqual(SambucaEntry.objects.filter(user=self.owner).count(), 2)
        log_sip(self.campaign, self.owner, amount=3, when=when, confirm=True)
        self.assertEqual(sum(SambucaEntry.objects.filter(user=self.owner).values_list("amount", flat=True)), 9)

    def test_settled_day_rejects_undo(self):
        when = _at(datetime.date(2026, 2, 9), 20)
        log_sip(self.campaign, self.owner, amount=1, when=when)
        settle_due_crowns(now=_at(datetime.date(2026, 2, 10), 6))
        from .skiweek import SkiWeekError
        with self.assertRaises(SkiWeekError):
            undo_last_sip(self.campaign, self.owner)


class SkiWeekWeatherTests(TestCase):
    def test_weather_caches_and_labels_valley_and_summit(self):
        calls = {"n": 0}

        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return self.payload

        def getter(url, params=None, timeout=None, headers=None):
            calls["n"] += 1
            elevation = int((params or {}).get("elevation") or 0)
            response = Response()
            response.payload = {
                "current": {
                    "temperature_2m": -8 if elevation > 2000 else -2,
                    "weather_code": 71,
                    "snowfall": 0.4,
                    "snow_depth": 1.64 if elevation > 2000 else 0.82,
                    "freezing_level_height": 1500,
                },
                "daily": {
                    "time": ["2026-02-10", "2026-02-11"],
                    "weather_code": [71, 3],
                    "temperature_2m_max": [-1, 2],
                    "temperature_2m_min": [-9, -4],
                    "snowfall_sum": [6.5, 0],
                },
            }
            return response

        cache.clear()
        first = fetch_weather(46.02, 7.75, "Europe/Zurich", 3883, 1620, getter=getter)
        second = fetch_weather(46.02, 7.75, "Europe/Zurich", 3883, 1620, getter=getter)
        self.assertTrue(first["available"])
        self.assertEqual(first["current"]["label"], "Snow")
        self.assertEqual(first["current"]["snow_valley_cm"], 82)
        self.assertEqual(first["current"]["snow_summit_cm"], 164)
        self.assertEqual(first["current"]["temperature_c"], -2)
        self.assertEqual(first["current"]["summit_temperature_c"], -8)
        self.assertIn("Open-Meteo", first["attribution"])
        self.assertEqual(len(first["daily"]), 2)
        self.assertEqual(calls["n"], 2)
        self.assertEqual(second["current"]["snow_summit_cm"], 164)

    def test_weather_falls_back_to_the_snapshot_when_the_source_is_down(self):
        owner = CustomUser.objects.create_user(email="wx@ski.test", password="test-pw", first_name="Lena")
        today = timezone.localdate()
        competition = Competition.objects.create(
            owner=owner, name="Snow", start_date=today, end_date=today + datetime.timedelta(days=6),
        )
        campaign = SkiWeekCampaign.objects.create(
            competition=competition, enabled=True, resort_name="Zermatt",
            latitude=Decimal("46.02"), longitude=Decimal("7.75"),
            weather_snapshot={"current": {"temperature_c": -4, "label": "Snow", "snow_valley_cm": 70, "snow_summit_cm": 140}, "daily": [{"date": today.isoformat(), "label": "Snow"}]},
        )

        def getter(*args, **kwargs):
            raise OSError("offline")

        payload = weather_for_campaign(campaign, getter=getter)
        self.assertTrue(payload["available"])
        self.assertTrue(payload["snapshot"])
        self.assertEqual(payload["current"]["label"], "Snow")


class SkiWeekApiTests(TestCase):
    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = APIClient()
        self.owner = CustomUser.objects.create_user(email="owner@ski.test", password="test-pw", first_name="Lena")
        self.other = CustomUser.objects.create_user(email="other@ski.test", password="test-pw", first_name="Otto")
        self.client.force_authenticate(self.owner)
        self.start = timezone.localdate()
        self.end = self.start + datetime.timedelta(days=6)

    def test_create_attaches_a_resort_and_lists_alpine_resorts(self):
        created = self.client.post("/api/competition/", {
            "name": "Walliser Woche",
            "start_date": self.start.isoformat(),
            "end_date": self.end.isoformat(),
            "has_teams": True,
            "skiweek_enabled": True,
            "skiweek_resort_slug": "zermatt",
            "skiweek_cutoff_hour": 5,
            "skiweek_water_enabled": True,
            "skiweek_points_per_sambuca": "5.00",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        body = created.json()
        self.assertTrue(body["skiweek_enabled"])
        self.assertEqual(body["skiweek_resort_name"], "Zermatt")
        self.assertEqual(body["skiweek_timezone"], "Europe/Zurich")
        self.assertEqual(body["skiweek_cutoff_hour"], 5)
        self.assertEqual(body["skiweek_points_per_sambuca"], 5.0)
        campaign = SkiWeekCampaign.objects.get(competition_id=body["id"])
        self.assertEqual(campaign.summit_elevation_m, 3883)

        resorts = self.client.get("/api/skiweek/resorts/")
        self.assertEqual(resorts.status_code, 200)
        slugs = [row["slug"] for row in resorts.json()["resorts"]]
        self.assertIn("zermatt", slugs)
        self.assertIn("chamonix", slugs)

        plain = self.client.post("/api/competition/", {
            "name": "Plain", "start_date": self.start.isoformat(), "end_date": self.end.isoformat(),
        }, format="json")
        self.assertFalse(plain.json()["skiweek_enabled"])
        self.assertFalse(SkiWeekCampaign.objects.filter(competition_id=plain.json()["id"]).exists())

    def test_unknown_resort_and_outsider_are_rejected(self):
        bad = self.client.post("/api/competition/", {
            "name": "Nope", "start_date": self.start.isoformat(), "end_date": self.end.isoformat(),
            "skiweek_enabled": True, "skiweek_resort_slug": "aspen",
        }, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("skiweek_resort_slug", bad.json())

        competition = Competition.objects.create(
            owner=self.owner, name="Closed", start_date=self.start, end_date=self.end,
        )
        SkiWeekCampaign.objects.create(
            competition=competition, enabled=True, resort_slug="zermatt", resort_name="Zermatt",
            latitude=Decimal("46.02"), longitude=Decimal("7.75"),
        )
        self.client.force_authenticate(self.other)
        missing = self.client.get(f"/api/competition/{competition.id}/skiweek/")
        self.assertEqual(missing.status_code, 404)

    def test_counter_confirm_photo_and_weather_endpoint(self):
        created = self.client.post("/api/competition/", {
            "name": "Après",
            "start_date": self.start.isoformat(),
            "end_date": self.end.isoformat(),
            "skiweek_enabled": True,
            "skiweek_resort_slug": "verbier",
            "skiweek_water_enabled": True,
        }, format="json")
        cid = created.json()["id"]
        first = self.client.post(f"/api/competition/{cid}/skiweek/sips/", {"amount": 1, "kind": "sambuca"}, format="json")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(first.json()["today"]["sambuca_mine"], 1)
        self.assertEqual(first.json()["live"]["leaders"][0]["username"], "Lena")

        for _ in range(4):
            self.client.post(f"/api/competition/{cid}/skiweek/sips/", {"amount": 1}, format="json")
        blocked = self.client.post(f"/api/competition/{cid}/skiweek/sips/", {"amount": 3}, format="json")
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["code"], "confirm_sambuca")
        allowed = self.client.post(
            f"/api/competition/{cid}/skiweek/sips/",
            {"amount": 3, "confirm": True},
            format="json",
        )
        self.assertEqual(allowed.status_code, 201, allowed.content)
        self.assertGreaterEqual(allowed.json()["today"]["sambuca_mine"], 8)

        photo = self.client.post(
            f"/api/competition/{cid}/skiweek/sips/",
            {"amount": 1, "kind": "water", "photo": SimpleUploadedFile("glass.png", PNG_1PX, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(photo.status_code, 201, photo.content)
        water_log = next(row for row in photo.json()["today"]["logs"] if row["kind"] == "water")
        self.assertTrue(water_log["has_photo"])
        picture = self.client.get(water_log["photo_url"])
        self.assertEqual(picture.status_code, 200)

        undone = self.client.delete(f"/api/competition/{cid}/skiweek/sips/?kind=water")
        self.assertEqual(undone.status_code, 200)
        self.assertFalse(any(row["kind"] == "water" for row in undone.json()["today"]["logs"]))

        opening = self.start.isoformat()

        def getter(url, params=None, timeout=None, headers=None):
            class Response:
                def raise_for_status(self):
                    return None
                def json(self):
                    return {
                        "current": {"temperature_2m": -3, "weather_code": 71, "snowfall": 0.1, "snow_depth": 0.9, "freezing_level_height": 1400},
                        "daily": {"time": [opening], "weather_code": [71], "temperature_2m_max": [0], "temperature_2m_min": [-6], "snowfall_sum": [2]},
                    }
            return Response()

        with mock.patch("competition.skiweek.requests.get", getter):
            cache.clear()
            weather = self.client.get(f"/api/competition/{cid}/skiweek/weather/")
        self.assertEqual(weather.status_code, 200)
        self.assertTrue(weather.json()["available"])
        self.assertEqual(weather.json()["resort"], "Verbier")
        self.assertIn("Open-Meteo", weather.json()["attribution"])

    def test_elevation_and_runs_are_optional_workout_fields(self):
        created = self.client.post("/api/workout/", {
            "sport_type": "AlpineSki",
            "start_datetime": timezone.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "duration": "01:30:00",
            "intensity_category": 2,
            "elevation_m": "1540.5",
            "runs": 9,
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["runs"], 9)
        self.assertEqual(float(created.json()["elevation_m"]), 1540.5)
        missing = self.client.post("/api/workout/", {
            "sport_type": "Run",
            "start_datetime": timezone.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "duration": "00:20:00",
            "intensity_category": 2,
        }, format="json")
        self.assertEqual(missing.status_code, 201, missing.content)
        self.assertIsNone(missing.json()["elevation_m"])
        self.assertIsNone(missing.json()["runs"])

    def test_settle_task_is_scheduled(self):
        from django_celery_beat.models import PeriodicTask
        from workout_challenge.celery import app
        task = PeriodicTask.objects.get(name="skiweek_settle")
        self.assertEqual(task.task, "competition.tasks.settle_skiweek_crowns")
        self.assertTrue(task.enabled)
        self.assertEqual(app.conf.beat_schedule["skiweek_settle"]["task"], task.task)


class ResortAndImportTests(TestCase):
    def test_provider_payloads_fill_elevation_and_runs_without_wiping_blanks(self):
        self.assertEqual(
            optional_activity_metrics({"total_elevation_gain": 842.44, "numberOfRuns": 12}),
            {"elevation_m": 842.4, "runs": 12},
        )
        self.assertEqual(optional_activity_metrics({"summaryDTO": {"elevationGain": 10}}), {})
        self.assertEqual(optional_activity_metrics({}), {})

    def test_free_text_geocoding_stays_inside_the_alps(self):
        known = resolve_resort(query="Zermatt")
        self.assertEqual(known["slug"], "zermatt")

        def getter(url, params=None, timeout=None, headers=None):
            class Response:
                def raise_for_status(self):
                    return None
                def json(self):
                    return {"results": [
                        {"name": "Miami", "latitude": 25.76, "longitude": -80.19, "elevation": 2},
                        {"name": "Les Arcs", "latitude": 45.57, "longitude": 6.83, "elevation": 1600},
                    ]}
            return Response()

        hit = geocode_alpine("Les Arcs", getter=getter)
        self.assertEqual(hit["name"], "Les Arcs")
        self.assertEqual(hit["valley_elevation_m"], 1600)

        def only_miami(url, params=None, timeout=None, headers=None):
            class Response:
                def raise_for_status(self):
                    return None
                def json(self):
                    return {"results": [{"name": "Miami", "latitude": 25.76, "longitude": -80.19}]}
            return Response()

        with self.assertRaises(ResortError):
            geocode_alpine("Miami Beach", getter=only_miami)


class SkiWeekCountdownTests(TestCase):
    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "drill_instructor.tasks.post_workout_comment.delay",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.owner = CustomUser.objects.create_user(email="count@ski.test", password="test-pw", first_name="Lena")
        self.start = datetime.date(2026, 2, 8)
        self.competition = Competition.objects.create(
            owner=self.owner, name="Countdown", start_date=self.start, end_date=datetime.date(2026, 2, 14),
        )
        self.campaign = SkiWeekCampaign.objects.create(
            competition=self.competition, enabled=True, resort_slug="zermatt", resort_name="Zermatt",
            latitude=Decimal("46.02"), longitude=Decimal("7.75"),
            summit_elevation_m=3883, valley_elevation_m=1620,
            timezone="Europe/Zurich",
        )

    def test_phase_switches_from_prestart_to_live_at_midnight(self):
        self.assertEqual(phase_of(self.campaign, _at(datetime.date(2026, 2, 7), 23, 59)), "prestart")
        self.assertEqual(phase_of(self.campaign, _at(datetime.date(2026, 2, 8), 0, 0)), "live")
        self.assertEqual(phase_of(self.campaign, _at(datetime.date(2026, 2, 15), 0, 1)), "ended")

    def test_milestones_are_the_named_beats_only(self):
        self.assertEqual(milestone_for(self.campaign, _at(datetime.date(2026, 1, 25), 12)), "d14")
        self.assertEqual(milestone_for(self.campaign, _at(datetime.date(2026, 2, 1), 12)), "d7")
        self.assertEqual(milestone_for(self.campaign, _at(datetime.date(2026, 2, 5), 12)), "d3")
        self.assertEqual(milestone_for(self.campaign, _at(datetime.date(2026, 2, 7), 10)), "d1")
        self.assertEqual(milestone_for(self.campaign, _at(datetime.date(2026, 2, 7), 20)), "final")
        self.assertEqual(milestone_for(self.campaign, _at(datetime.date(2026, 2, 8), 1)), "kickoff")
        self.assertIsNone(milestone_for(self.campaign, _at(datetime.date(2026, 2, 6), 12)))
        self.assertIsNone(milestone_for(self.campaign, _at(datetime.date(2026, 2, 8), 12)))

    def test_teaser_uses_the_persona_once_and_falls_back_when_unsafe(self):
        from drill_instructor.models import DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona
        persona = DrillInstructorPersona.objects.create(
            name="Alpine Coach", system_prompt="Short, dry, mountain-obsessed.", language="en", avatar="summit",
        )
        DrillInstructorConfig.objects.create(
            competition=self.competition, persona=persona, enabled=True, send_push_on_activity=False,
        )
        weather = {
            "available": True,
            "fresh_snow_cm": 12,
            "snowfall_24h_cm": 12,
            "snowfall_72h_cm": 28,
            "current": {"snow_valley_cm": 80, "snow_summit_cm": 160, "freezing_level_m": 1400, "label": "Snow"},
            "opening_days": [{"date": "2026-02-08", "label": "Snow", "snowfall_cm": 6}],
        }

        def generator(**kwargs):
            self.assertIn("Zermatt", kwargs["user_prompt"])
            self.assertIn("12 cm", kwargs["user_prompt"])
            self.assertNotIn("drink", kwargs["user_prompt"].split("Do not")[0].lower())
            return "Zermatt has 12 cm of fresh snow. The mountain is waiting.", None

        when = _at(datetime.date(2026, 2, 1), 12)
        teaser = post_teaser_if_due(self.campaign, now=when, generator=generator, weather=weather)
        self.assertEqual(teaser.source, "llm")
        self.assertIn("Zermatt", teaser.body)
        self.assertEqual(SkiWeekTeaser.objects.filter(campaign=self.campaign).count(), 1)
        self.assertEqual(DrillInstructorMessage.objects.filter(kind=DrillInstructorMessage.KIND_SKIWEEK).count(), 1)
        again = post_teaser_if_due(self.campaign, now=when, generator=generator, weather=weather)
        self.assertIsNone(again)
        self.assertEqual(SkiWeekTeaser.objects.filter(campaign=self.campaign).count(), 1)

        def unsafe(**kwargs):
            return "Have a sambuca and drink more before Zermatt.", None

        body, source, _config = compose_teaser(self.campaign, "final", weather, generator=unsafe)
        self.assertEqual(source, "fallback")
        self.assertNotIn("sambuca", body.lower())
        self.assertIn("Zermatt", body)
        self.assertIn("12 cm", body)
        self.assertLess(body.lower().count(" cm"), 3)
        self.assertNotIn("freezing", body.lower())
        self.assertNotIn("72", body)

    def test_displayed_line_matches_the_days_actually_left(self):
        from competition.skiweek import coach_teaser_payload
        from competition.models import SkiWeekTeaser
        SkiWeekTeaser.objects.create(
            campaign=self.campaign, milestone="d3", source="fallback",
            body="Three days to Zermatt. 14 cm of fresh snow and 160 cm on the summit.",
        )
        weather = {
            "available": True,
            "fresh_snow_cm": 14,
            "snowfall_72h_cm": 31,
            "current": {"snow_summit_cm": 168, "freezing_level_m": 1480},
        }
        # 8 Feb midnight is 1 day and 12 hours after 6 Feb noon, so the clock says 1.
        payload = coach_teaser_payload(self.campaign, now=_at(datetime.date(2026, 2, 6), 12), weather=weather)
        self.assertEqual(payload["days_left"], 1)
        self.assertNotIn("Three", payload["body"])
        self.assertIn("One day", payload["body"])
        self.assertLess(payload["body"].lower().count(" cm"), 3)

    def test_recent_snowfall_and_opening_days_come_from_the_hourly_feed(self):
        cache.clear()
        now = _at(datetime.date(2026, 2, 6), 12)
        hours = []
        snow = []
        for offset in range(72, -1, -1):
            moment = now - datetime.timedelta(hours=offset)
            hours.append(moment.strftime("%Y-%m-%dT%H:%M"))
            snow.append(0.5)

        def getter(url, params=None, timeout=None, headers=None):
            class Response:
                def raise_for_status(self):
                    return None
                def json(self):
                    elevation = int((params or {}).get("elevation") or 0)
                    return {
                        "current": {
                            "temperature_2m": -8 if elevation > 2000 else -1,
                            "weather_code": 3,
                            "snowfall": 0,
                            "snow_depth": 1.5 if elevation > 2000 else 0.7,
                            "freezing_level_height": 1600,
                        },
                        "hourly": {"time": hours, "snowfall": snow},
                        "daily": {
                            "time": ["2026-02-06", "2026-02-07", "2026-02-08", "2026-02-09"],
                            "weather_code": [3, 71, 71, 2],
                            "temperature_2m_max": [1, -1, -2, 0],
                            "temperature_2m_min": [-4, -8, -9, -5],
                            "snowfall_sum": [0, 4, 8, 1],
                        },
                    }
            return Response()

        from competition.skiweek import fetch_weather
        cache.clear()
        raw = fetch_weather(46.02, 7.75, "Europe/Zurich", 3883, 1620, getter=getter, now=now)
        self.assertEqual(raw["snowfall_24h_cm"], 12.0)
        self.assertEqual(raw["snowfall_72h_cm"], 36.0)
        self.assertEqual(raw["current"]["snow_valley_cm"], 70)
        self.assertEqual(raw["current"]["snow_summit_cm"], 150)
        self.assertEqual(raw["current"]["freezing_level_m"], 1600)
        self.assertEqual(raw["mood"], "fresh")
        self.assertFalse(raw["is_snowing"])
        opened = weather_for_campaign(self.campaign, getter=getter)
        # Cached raw payload has no opening_days until attach. Clear and use a wrapper.
        cache.clear()
        with mock.patch("competition.skiweek.fetch_weather", return_value=raw):
            opened = weather_for_campaign(self.campaign)
        dates = [row["date"] for row in opened["opening_days"]]
        self.assertEqual(dates, ["2026-02-08", "2026-02-09"])
        self.assertTrue(opened["opening_forecast_ready"])
        self.assertIn("Open-Meteo", opened["attribution"])

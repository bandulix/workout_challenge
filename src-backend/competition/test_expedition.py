import datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from custom_user.models import CustomUser
from drill_instructor.models import DrillInstructorConfig, DrillInstructorPersona
from workouts.models import Workout
from .models import (
    Competition,
    ExpeditionCampaign,
    ExpeditionContribution,
    Points,
)
from .expedition import (
    _score_periods,
    build_milestone_schedule,
    recompute_expedition_progress,
    synchronize_expedition,
)
from .expedition_api import _milestone_status


class MilestoneScheduleTests(SimpleTestCase):
    def test_same_day_challenge_keeps_stable_milestone_ids_and_exact_bounds(self):
        day = datetime.date(2026, 10, 3)

        schedule = build_milestone_schedule(day, day)

        self.assertEqual([item["milestone_id"] for item in schedule], [
            "trailhead", "river-crossing", "high-pass", "finale",
        ])
        self.assertEqual(schedule[0]["opens_on"], day)
        self.assertEqual(schedule[-1]["target_on"], day)
        self.assertTrue(all(item["target_on"] == day for item in schedule))
        self.assertEqual([item["progress_fraction"] for item in schedule], [
            Decimal("0.00"), Decimal("0.25"), Decimal("0.60"), Decimal("1.00"),
        ])

    def test_short_and_long_challenges_distribute_milestones_proportionally(self):
        start = datetime.date(2026, 10, 1)

        short = build_milestone_schedule(start, start + datetime.timedelta(days=3))
        long = build_milestone_schedule(start, start + datetime.timedelta(days=30))

        self.assertEqual(
            [item["target_on"] for item in short],
            [start + datetime.timedelta(days=offset) for offset in (0, 1, 2, 3)],
        )
        self.assertEqual(
            [item["target_on"] for item in long],
            [start + datetime.timedelta(days=offset) for offset in (0, 10, 20, 30)],
        )
        self.assertEqual(
            [item["stage_id"] for item in short],
            [item["stage_id"] for item in long],
        )

    def test_score_windows_use_local_midnight_across_dst_boundary(self):
        start = datetime.date(2026, 3, 7)
        end = datetime.date(2026, 3, 9)

        with timezone.override("America/Los_Angeles"):
            periods = list(_score_periods(start, end))
            first_start = timezone.localtime(periods[0][3])
            final_end = timezone.localtime(periods[-1][4])

        self.assertEqual(first_start.date(), start)
        self.assertEqual(first_start.time(), datetime.time.min)
        self.assertEqual(first_start.utcoffset(), datetime.timedelta(hours=-8))
        self.assertEqual(final_end.date(), end + datetime.timedelta(days=1))
        self.assertEqual(final_end.time(), datetime.time.min)
        self.assertEqual(final_end.utcoffset(), datetime.timedelta(hours=-7))

    def test_reversed_challenge_dates_are_rejected(self):
        start = datetime.date(2026, 10, 2)
        end = start - datetime.timedelta(days=1)

        with self.assertRaises(ValueError):
            build_milestone_schedule(start, end)


class ExpeditionMilestoneStatusTests(SimpleTestCase):
    def test_unopened_milestone_is_upcoming(self):
        opens = datetime.date(2026, 10, 12)
        milestone = SimpleNamespace(
            completed_at=None,
            milestone_id="river-crossing",
            opens_on=opens,
            target_on=opens + datetime.timedelta(days=3),
        )

        self.assertEqual(
            _milestone_status(milestone, Decimal("0"), opens - datetime.timedelta(days=1), opens),
            "upcoming",
        )

    def test_open_milestone_before_target_is_in_progress(self):
        opens = datetime.date(2026, 10, 12)
        milestone = SimpleNamespace(
            completed_at=None,
            milestone_id="river-crossing",
            opens_on=opens,
            target_on=opens + datetime.timedelta(days=3),
        )

        self.assertEqual(
            _milestone_status(milestone, Decimal("25"), opens, opens + datetime.timedelta(days=3)),
            "in-progress",
        )

    def test_missed_milestone_remains_on_route_as_behind(self):
        target = datetime.date(2026, 10, 12)
        milestone = SimpleNamespace(
            completed_at=None,
            milestone_id="high-pass",
            opens_on=target - datetime.timedelta(days=3),
            target_on=target,
        )

        self.assertEqual(
            _milestone_status(milestone, Decimal("45"), target + datetime.timedelta(days=1), target),
            "behind",
        )

    def test_full_progress_holds_finale_until_challenge_end(self):
        end_date = datetime.date(2026, 10, 30)
        milestone = SimpleNamespace(
            completed_at=None,
            milestone_id="finale",
            opens_on=end_date - datetime.timedelta(days=5),
            target_on=end_date,
        )

        self.assertEqual(
            _milestone_status(milestone, Decimal("100"), end_date - datetime.timedelta(days=1), end_date),
            "ready",
        )

    def test_completed_milestone_status_is_durable(self):
        today = datetime.date(2026, 10, 30)
        milestone = SimpleNamespace(
            completed_at=timezone.now(),
            milestone_id="finale",
            opens_on=today + datetime.timedelta(days=1),
            target_on=today + datetime.timedelta(days=2),
        )

        self.assertEqual(
            _milestone_status(milestone, Decimal("0"), today, today),
            "completed",
        )


class ExpeditionCampaignTests(TestCase):
    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)

        self.owner = CustomUser.objects.create_user(
            email="expedition-owner@example.com", password="test-pw",
        )
        today = timezone.localdate()
        self.start_date = today + datetime.timedelta(days=10)
        self.end_date = today + datetime.timedelta(days=39)
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Expedition Test",
            start_date=self.start_date,
            end_date=self.end_date,
        )
        self.owner.my_competitions.add(self.competition)

    def test_campaign_persists_stable_milestones_for_exact_competition_dates(self):
        campaign = ExpeditionCampaign.objects.create(competition=self.competition)

        synchronize_expedition(
            campaign,
            today=self.start_date - datetime.timedelta(days=1),
        )

        campaign.refresh_from_db()
        milestones = list(campaign.milestones.order_by("sequence"))
        self.assertEqual((campaign.start_date, campaign.end_date), (self.start_date, self.end_date))
        self.assertEqual([item.milestone_id for item in milestones], [
            "trailhead", "river-crossing", "high-pass", "finale",
        ])
        self.assertEqual(milestones[0].target_on, self.start_date)
        self.assertEqual(milestones[-1].target_on, self.end_date)
        self.assertIsNone(campaign.locked_at)

    def test_schedule_recalculates_before_start_but_keeps_milestone_ids(self):
        campaign = ExpeditionCampaign.objects.create(competition=self.competition)
        synchronize_expedition(campaign, today=self.start_date - datetime.timedelta(days=2))
        original_ids = list(campaign.milestones.order_by("sequence").values_list("milestone_id", flat=True))

        self.competition.start_date += datetime.timedelta(days=2)
        self.competition.end_date += datetime.timedelta(days=5)
        self.competition.save(update_fields=["start_date", "end_date"])
        campaign.refresh_from_db()
        self.assertEqual(campaign.start_date, self.competition.start_date)
        self.assertEqual(campaign.end_date, self.competition.end_date)

        synchronize_expedition(campaign, today=self.start_date - datetime.timedelta(days=1))

        campaign.refresh_from_db()
        milestones = list(campaign.milestones.order_by("sequence"))
        self.assertEqual(campaign.start_date, self.competition.start_date)
        self.assertEqual(campaign.end_date, self.competition.end_date)
        self.assertEqual([item.milestone_id for item in milestones], original_ids)
        self.assertEqual(milestones[0].target_on, self.competition.start_date)
        self.assertEqual(milestones[-1].target_on, self.competition.end_date)

    def test_schedule_dates_lock_at_start_and_ignore_later_competition_edits(self):
        self.competition.start_date = timezone.localdate()
        self.competition.end_date = self.competition.start_date + datetime.timedelta(days=20)
        self.competition.save(update_fields=["start_date", "end_date"])
        campaign = ExpeditionCampaign.objects.create(competition=self.competition)
        launch_end = campaign.end_date

        campaign = synchronize_expedition(campaign, today=campaign.start_date, now=timezone.now())
        self.assertIsNotNone(campaign.locked_at)
        locked_finale = campaign.milestones.get(milestone_id="finale").target_on

        self.competition.end_date += datetime.timedelta(days=7)
        self.competition.save(update_fields=["end_date"])
        synchronize_expedition(campaign, today=launch_end + datetime.timedelta(days=1))

        campaign.refresh_from_db()
        finale = campaign.milestones.get(milestone_id="finale")
        self.assertEqual(campaign.end_date, launch_end)
        self.assertEqual(finale.target_on, locked_finale)


class ExpeditionApiTests(TestCase):
    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)

        self.owner = CustomUser.objects.create_user(
            email="expedition-api-owner@example.com", password="test-pw",
        )
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Pilot Expedition",
            start_date=today + datetime.timedelta(days=5),
            end_date=today + datetime.timedelta(days=34),
        )
        self.owner.my_competitions.add(self.competition)
        self.campaign = ExpeditionCampaign.objects.create(competition=self.competition)
        from custom_user.models import RecalcRequest
        RecalcRequest.objects.filter(
            user=self.owner,
            goal__competition_id=self.competition.pk,
        ).delete()
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)
        self.url = reverse("competition-expedition", kwargs={"competition_id": self.competition.pk})
        cache.clear()

    def test_campaign_is_hidden_until_its_pilot_flag_is_enabled(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 404)

    def test_enabled_campaign_exposes_dates_stable_milestones_and_default_guide(self):
        self.campaign.enabled = True
        self.campaign.save(update_fields=["enabled"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["route_template"], "trail-v1")
        self.assertEqual(data["start_date"], self.competition.start_date.isoformat())
        self.assertEqual(data["end_date"], self.competition.end_date.isoformat())
        self.assertEqual(data["current_coach"]["name"], "Trail Guide")
        self.assertEqual(data["current_coach"]["source"], "default")
        self.assertIsNone(data["current_coach"]["avatar_asset_key"])
        self.assertEqual(data["milestones"][0]["approved_asset_key"], "trailhead-v1")
        self.assertEqual(data["participant_count"], 1)
        self.assertEqual(data["progress_percent"], 0.0)
        self.assertEqual(data["personal_progress_percent"], 0.0)
        self.assertEqual(data["milestones"][0]["status"], "upcoming")
        self.assertEqual([item["milestone_id"] for item in data["milestones"]], [
            "trailhead", "river-crossing", "high-pass", "finale",
        ])
        self.assertNotIn("latitude", data)
        self.assertNotIn("longitude", data)
        self.assertNotIn("points", data)

    def test_repeated_get_reuses_materialized_progress_for_refresh_window(self):
        from .expedition import recompute_expedition_progress as real_recompute

        self.campaign.enabled = True
        self.campaign.save(update_fields=["enabled"])
        with mock.patch(
            "competition.expedition_api.recompute_expedition_progress",
            wraps=real_recompute,
        ) as refresh:
            first = self.client.get(self.url)
            second = self.client.get(self.url)
            cache.set(f"stats-generation:{self.competition.pk}", 1, None)
            after_score_update = self.client.get(self.url)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(after_score_update.status_code, 200)
        self.assertEqual(first.json()["progress_percent"], second.json()["progress_percent"])
        self.assertEqual(refresh.call_count, 2)

    def test_future_milestones_use_the_enabled_competition_coach(self):
        persona = DrillInstructorPersona.objects.create(
            name="Trail Coach",
            system_prompt="Keep the group moving safely.",
            avatar="captain",
            theme_color="#426b55",
        )
        DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=persona,
        )
        self.campaign.enabled = True
        self.campaign.save(update_fields=["enabled"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        coach = response.json()["current_coach"]
        self.assertEqual(coach["id"], persona.pk)
        self.assertEqual(coach["name"], "Trail Coach")
        self.assertEqual(coach["source"], "competition")
        self.assertEqual(coach["avatar_asset_key"], "captain")

    def test_custom_coach_avatar_falls_back_without_exposing_an_asset_path(self):
        persona = DrillInstructorPersona.objects.create(
            name="Custom Asset Coach",
            system_prompt="Keep the group moving safely.",
            avatar="../../unreviewed.svg",
        )
        DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=persona,
        )
        self.campaign.enabled = True
        self.campaign.save(update_fields=["enabled"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        coach = response.json()["current_coach"]
        self.assertIsNone(coach["avatar_asset_key"])
        self.assertNotIn("profile_picture", coach)

    def test_coach_change_shows_handover_at_next_uncompleted_milestone(self):
        today = timezone.localdate()
        self.competition.start_date = today
        self.competition.end_date = today + datetime.timedelta(days=13)
        self.competition.save(update_fields=["start_date", "end_date"])
        self.campaign.start_date = today
        self.campaign.end_date = self.competition.end_date
        self.campaign.enabled = True
        self.campaign.save(update_fields=["start_date", "end_date", "enabled"])
        first_coach = DrillInstructorPersona.objects.create(
            name="First Handover Coach", system_prompt="Guide the first leg.",
            avatar="captain", theme_color="#426b55",
        )
        config = DrillInstructorConfig.objects.create(
            competition=self.competition, enabled=True, persona=first_coach,
        )

        first_response = self.client.get(self.url)
        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(
            first_response.json()["milestones"][0]["coach_snapshot"]["name"],
            first_coach.name,
        )
        next_coach = DrillInstructorPersona.objects.create(
            name="Next Handover Coach", system_prompt="Guide the next leg.",
            avatar="zen", theme_color="#607d8b",
        )
        config.persona = next_coach
        config.save(update_fields=["persona"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        handover = response.json()["coach_handover"]
        self.assertEqual(handover["from"]["name"], first_coach.name)
        self.assertEqual(handover["to"]["name"], next_coach.name)
        self.assertEqual(handover["milestone_id"], "river-crossing")

    def test_repeated_coach_changes_and_disabled_coach_have_deterministic_handover(self):
        today = timezone.localdate()
        self.competition.start_date = today
        self.competition.end_date = today + datetime.timedelta(days=13)
        self.competition.save(update_fields=["start_date", "end_date"])
        self.campaign.start_date = today
        self.campaign.end_date = self.competition.end_date
        self.campaign.enabled = True
        self.campaign.save(update_fields=["start_date", "end_date", "enabled"])
        first = DrillInstructorPersona.objects.create(
            name="Original Coach", system_prompt="Guide the first leg.",
        )
        config = DrillInstructorConfig.objects.create(
            competition=self.competition, enabled=True, persona=first,
        )
        self.client.get(self.url)

        second = DrillInstructorPersona.objects.create(
            name="Intermediate Coach", system_prompt="Guide briefly.",
        )
        third = DrillInstructorPersona.objects.create(
            name="Current Coach", system_prompt="Guide the next leg.",
        )
        config.persona = second
        config.save(update_fields=["persona"])
        config.persona = third
        config.save(update_fields=["persona"])

        repeated_change = self.client.get(self.url).json()["coach_handover"]
        self.assertEqual(repeated_change["from"]["name"], first.name)
        self.assertEqual(repeated_change["to"]["name"], third.name)
        self.assertEqual(repeated_change["milestone_id"], "river-crossing")

        config.enabled = False
        config.save(update_fields=["enabled"])
        disabled_fallback = self.client.get(self.url).json()
        self.assertEqual(disabled_fallback["current_coach"]["name"], "Trail Guide")
        self.assertEqual(disabled_fallback["coach_handover"]["from"]["name"], first.name)
        self.assertEqual(disabled_fallback["coach_handover"]["to"]["name"], "Trail Guide")

    def test_finale_response_uses_the_actual_end_date_without_exposing_private_snapshots(self):
        today = timezone.localdate()
        final_date = today - datetime.timedelta(days=1)
        start_date = final_date - datetime.timedelta(days=13)
        self.competition.start_date = start_date
        self.competition.end_date = final_date
        self.competition.save(update_fields=["start_date", "end_date"])
        self.campaign.start_date = start_date
        self.campaign.end_date = final_date
        self.campaign.enabled = True
        self.campaign.save(update_fields=["start_date", "end_date", "enabled"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        finale = response.json()["finale"]
        self.assertEqual(finale["final_date"], final_date.isoformat())
        self.assertEqual(finale["status"], "final")
        self.assertEqual(finale["group_progress_percent"], 0.0)
        self.assertEqual(finale["personal_progress_percent"], 0.0)
        self.assertNotIn("personal_progress_by_participant", finale)

    def test_nonparticipants_cannot_read_the_expedition(self):
        self.campaign.enabled = True
        self.campaign.save(update_fields=["enabled"])
        outsider = CustomUser.objects.create_user(
            email="expedition-outsider@example.com", password="test-pw",
        )
        self.client.force_authenticate(user=outsider)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 404)


class ExpeditionProgressTests(TestCase):
    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)

        self.owner = CustomUser.objects.create_user(
            email="expedition-progress-owner@example.com", password="test-pw",
        )
        self.teammate = CustomUser.objects.create_user(
            email="expedition-progress-member@example.com", password="test-pw",
        )
        today = timezone.localdate()
        self.start_date = today + datetime.timedelta(days=7 - today.weekday())
        self.end_date = self.start_date + datetime.timedelta(days=13)
        self.competition = Competition.objects.create(
            owner=self.owner,
            name="Shared Route",
            start_date=self.start_date,
            end_date=self.end_date,
        )
        self.owner.my_competitions.add(self.competition)
        self.teammate.my_competitions.add(self.competition)
        self.campaign = ExpeditionCampaign.objects.create(competition=self.competition)
        self.goal = self.competition.activitygoal_set.get(name="Exercise")
        from custom_user.models import RecalcRequest
        RecalcRequest.objects.filter(
            user_id__in=[self.owner.pk, self.teammate.pk],
            goal__competition_id=self.competition.pk,
        ).delete()

    def test_crew_summary_explains_shares_this_week_and_next_landmark(self):
        from .expedition import expedition_crew_summary

        self.owner.first_name = "Zoe"
        self.owner.save(update_fields=["first_name"])
        self.teammate.first_name = "Ada"
        self.teammate.save(update_fields=["first_name"])
        # Two-week route, two people: target = 2 x 200 = 400 points.
        self.add_scored_workout(self.owner, self.start_date, 60)
        self.add_scored_workout(self.teammate, self.start_date, 20)
        today = self.start_date + datetime.timedelta(days=1)

        progress = recompute_expedition_progress(self.campaign, user_id=self.owner.pk, today=today)
        self.campaign.refresh_from_db()
        crew = expedition_crew_summary(self.campaign, progress, today=today, user_id=self.owner.pk)

        self.assertEqual(crew["weekly_cap_per_person"], 100.0)
        self.assertEqual(crew["target_per_person"], 200.0)
        # Day 2 of 7 in week one: a crew hitting every ceiling would be at 2/7 x 100 x 2 of 400.
        self.assertEqual(crew["pace_percent"], 14.3)
        # Neutral alphabetical order - not ranked by points.
        self.assertEqual([row["name"] for row in crew["contributors"]], ["Ada", "Zoe"])
        ada, zoe = crew["contributors"]
        self.assertEqual((ada["is_you"], zoe["is_you"]), (False, True))
        self.assertEqual((ada["points"], zoe["points"]), (20.0, 60.0))
        self.assertEqual((ada["week_energy_percent"], zoe["week_energy_percent"]), (20.0, 60.0))
        self.assertEqual((ada["share_percent"], zoe["share_percent"]), (25.0, 75.0))
        self.assertEqual((ada["personal_progress_percent"], zoe["personal_progress_percent"]), (10.0, 30.0))
        self.assertNotIn("email", ada)
        self.assertEqual(crew["this_week"], {
            "start_date": self.start_date.isoformat(),
            "end_date": (self.start_date + datetime.timedelta(days=6)).isoformat(),
            "earned_points": 80.0,
            "possible_points": 200.0,
            "cap_per_person": 100.0,
        })
        # 80 / 400 = 20%: trailhead done, river crossing (25% = 100 pts) needs 20 more.
        self.assertEqual(crew["next_milestone"]["milestone_id"], "river-crossing")
        self.assertEqual(crew["next_milestone"]["progress_percent"], 25.0)
        self.assertEqual(crew["next_milestone"]["points_to_go"], 20.0)
        self.assertFalse(crew["next_milestone"]["time_gated"])

    def test_finale_snapshot_waits_for_pending_cap_recalculation(self):
        from custom_user.models import RecalcRequest

        today = timezone.localdate()
        # The stored 15 points have to land in a full ISO week (cap 100).
        # Ending the route on "yesterday" makes the opening week a single
        # Sunday whenever local today is a Sunday, and 100 * 1/7 quantizes
        # to 14.29, which then clips the score. Pin the finale to the latest
        # Sunday strictly before local today so both weeks are Mon-Sun.
        days_since_sunday = (today.weekday() + 1) % 7
        final_date = today - datetime.timedelta(days=days_since_sunday or 7)
        start_date = final_date - datetime.timedelta(days=13)
        self.competition.start_date = start_date
        self.competition.end_date = final_date
        self.competition.save(update_fields=["start_date", "end_date"])
        self.campaign.start_date = start_date
        self.campaign.end_date = final_date
        self.campaign.save(update_fields=["start_date", "end_date"])
        points = self.add_scored_workout(self.owner, start_date, 500)
        pending = RecalcRequest.objects.create(
            user=self.owner,
            goal=self.goal,
            start_datetime=timezone.make_aware(
                datetime.datetime.combine(start_date, datetime.time.min),
                timezone.get_current_timezone(),
            ),
        )

        waiting = recompute_expedition_progress(
            self.campaign, user_id=self.owner.pk, today=today,
        )
        self.campaign.refresh_from_db()

        self.assertFalse(self.campaign.finale_snapshot)
        self.assertEqual(waiting["earned_points"], Decimal("0"))
        self.assertIsNotNone(self.campaign.milestones.get(milestone_id="finale").completed_at)

        points.points_capped = Decimal("15")
        points.save(update_fields=["points_capped"])
        pending.delete()
        finalized = recompute_expedition_progress(
            self.campaign, user_id=self.owner.pk, today=today,
        )
        self.campaign.refresh_from_db()

        self.assertEqual(finalized["earned_points"], Decimal("15.00"))
        self.assertEqual(Decimal(self.campaign.finale_snapshot["earned_points"]), Decimal("15.00"))

    def test_challenge_end_day_completes_the_finale_even_if_route_progress_is_short(self):
        progress = recompute_expedition_progress(
            self.campaign,
            user_id=self.owner.pk,
            today=self.end_date,
            now=timezone.make_aware(
                datetime.datetime.combine(self.end_date, datetime.time(hour=12)),
                timezone.get_current_timezone(),
            ),
        )

        finale = self.campaign.milestones.get(milestone_id="finale")
        self.assertEqual(progress["progress_percent"], Decimal("0.0"))
        self.assertIsNotNone(finale.completed_at)
        self.assertEqual(finale.completed_at.date(), self.end_date)

    def add_scored_workout(self, participant, day, points):
        started = timezone.make_aware(
            datetime.datetime.combine(day, datetime.time(12)),
            timezone.get_current_timezone(),
        )
        workout = Workout(
            user=participant,
            sport_type="Workout",
            start_datetime=started,
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )
        workout.save(score=False)
        return Points.objects.create(
            goal=self.goal,
            workout=workout,
            points_raw=Decimal(str(points)),
            points_capped=Decimal(str(points)),
        )

    def test_award_backed_points_count_toward_expedition_progress(self):
        from .models import Award

        award = Award.objects.create(
            competition=self.competition,
            name="Daily order",
            threshold=1,
            period="day",
            reward_points=10,
        )
        started = timezone.make_aware(
            datetime.datetime.combine(self.start_date, datetime.time(12)),
            timezone.get_current_timezone(),
        )
        workout = Workout(
            user=self.owner,
            sport_type="Workout",
            start_datetime=started,
            duration=datetime.timedelta(minutes=30),
            intensity_category=2,
        )
        workout.save(score=False)
        Points.objects.create(
            award=award,
            workout=workout,
            points_raw=Decimal("30"),
            points_capped=Decimal("30"),
        )

        progress = recompute_expedition_progress(
            self.campaign, user_id=self.owner.pk, today=self.start_date,
        )

        self.assertEqual(progress["earned_points"], Decimal("30.00"))
        self.assertEqual(progress["personal_points"], Decimal("30.00"))
        self.assertEqual(progress["progress_percent"], Decimal("7.5"))

    def test_late_member_does_not_change_locked_expedition_progress(self):
        late_member = CustomUser.objects.create_user(
            email="late-expedition-member@example.com", password="test-pw",
        )
        recompute_expedition_progress(
            self.campaign, user_id=self.owner.pk, today=self.start_date,
        )
        self.campaign.refresh_from_db()
        self.assertEqual(self.campaign.participant_ids_snapshot, sorted([self.owner.pk, self.teammate.pk]))
        late_member.my_competitions.add(self.competition)
        self.add_scored_workout(late_member, self.start_date, 100)

        progress = recompute_expedition_progress(
            self.campaign, user_id=self.owner.pk, today=self.start_date,
        )

        self.assertEqual(progress["participant_count"], 2)
        self.assertEqual(progress["earned_points"], Decimal("0.00"))
        self.assertFalse(ExpeditionContribution.objects.filter(
            campaign=self.campaign, participant=late_member,
        ).exists())

    def test_rollups_are_idempotent_and_one_participant_cannot_finish_a_group_route(self):
        first_week = self.add_scored_workout(self.owner, self.start_date, 500)
        second_first_week = self.add_scored_workout(
            self.owner,
            self.start_date + datetime.timedelta(days=1),
            500,
        )
        self.add_scored_workout(self.owner, self.start_date + datetime.timedelta(days=7), 500)

        progress = recompute_expedition_progress(
            self.campaign,
            user_id=self.owner.pk,
            today=self.start_date + datetime.timedelta(days=7),
        )
        contributions_after_first_sync = ExpeditionContribution.objects.filter(campaign=self.campaign).count()
        repeated = recompute_expedition_progress(
            self.campaign,
            user_id=self.owner.pk,
            today=self.start_date + datetime.timedelta(days=7),
        )

        self.assertEqual(progress["participant_count"], 2)
        self.assertEqual(float(progress["progress_percent"]), 50.0)
        self.assertEqual(float(progress["personal_progress_percent"]), 100.0)
        self.assertEqual(contributions_after_first_sync, 4)
        self.assertEqual(ExpeditionContribution.objects.filter(campaign=self.campaign).count(), 4)
        self.assertEqual(float(repeated["progress_percent"]), 50.0)
        self.assertFalse(self.campaign.milestones.get(milestone_id="finale").completed_at)

        # A score correction replaces the weekly rollup; it is never added a
        # second time just because the API/task ran again.
        first_week.delete()
        second_first_week.delete()
        corrected = recompute_expedition_progress(
            self.campaign,
            user_id=self.owner.pk,
            today=self.start_date + datetime.timedelta(days=7),
        )
        self.assertEqual(float(corrected["progress_percent"]), 25.0)
        self.assertEqual(ExpeditionContribution.objects.filter(campaign=self.campaign).count(), 4)

    def test_finale_snapshot_is_idempotent_and_uses_the_competition_end_date(self):
        self.add_scored_workout(self.owner, self.start_date, 100)
        final_day_time = timezone.make_aware(
            datetime.datetime.combine(self.end_date, datetime.time(hour=23, minute=59)),
            timezone.get_current_timezone(),
        )
        initial = recompute_expedition_progress(
            self.campaign,
            user_id=self.owner.pk,
            today=self.end_date + datetime.timedelta(days=1),
            now=final_day_time + datetime.timedelta(minutes=1),
        )
        self.campaign.refresh_from_db()
        original_snapshot = self.campaign.finale_snapshot

        self.assertEqual(original_snapshot["final_date"], self.end_date.isoformat())
        self.assertEqual(original_snapshot["participant_count"], 2)
        self.assertEqual(
            Decimal(original_snapshot["progress_percent"]),
            initial["progress_percent"],
        )
        self.assertEqual(
            Decimal(original_snapshot["personal_progress_by_participant"][str(self.owner.pk)]),
            initial["personal_progress_percent"],
        )
        self.assertNotIn("workouts", original_snapshot)

        self.add_scored_workout(self.teammate, self.end_date, 100)
        repeated = recompute_expedition_progress(
            self.campaign,
            user_id=self.owner.pk,
            today=self.end_date + datetime.timedelta(days=2),
        )
        self.campaign.refresh_from_db()

        self.assertEqual(self.campaign.finale_snapshot, original_snapshot)
        self.assertEqual(repeated["progress_percent"], initial["progress_percent"])

    def test_completed_milestones_keep_their_original_coach_snapshot(self):
        first_coach = DrillInstructorPersona.objects.create(
            name="First Trail Coach", system_prompt="Guide the first leg.",
        )
        config = DrillInstructorConfig.objects.create(
            competition=self.competition,
            enabled=True,
            persona=first_coach,
        )
        self.add_scored_workout(self.owner, self.start_date, 100)
        self.add_scored_workout(self.teammate, self.start_date, 20)

        initial = recompute_expedition_progress(
            self.campaign,
            user_id=self.owner.pk,
            today=self.start_date,
        )
        trailhead = self.campaign.milestones.get(milestone_id="trailhead")
        crossing = self.campaign.milestones.get(milestone_id="river-crossing")
        self.assertEqual(float(initial["progress_percent"]), 30.0)
        self.assertEqual(trailhead.coach_snapshot["name"], first_coach.name)
        self.assertEqual(crossing.coach_snapshot["name"], first_coach.name)

        next_coach = DrillInstructorPersona.objects.create(
            name="Second Trail Coach", system_prompt="Guide the next leg.",
        )
        config.persona = next_coach
        config.save(update_fields=["persona"])
        self.add_scored_workout(self.owner, self.start_date + datetime.timedelta(days=7), 100)
        self.add_scored_workout(self.teammate, self.start_date + datetime.timedelta(days=7), 50)

        later = recompute_expedition_progress(
            self.campaign,
            user_id=self.owner.pk,
            today=self.start_date + datetime.timedelta(days=9),
        )
        high_pass = self.campaign.milestones.get(milestone_id="high-pass")
        self.assertEqual(float(later["progress_percent"]), 67.5)
        self.assertEqual(trailhead.coach_snapshot["name"], first_coach.name)
        self.assertEqual(crossing.coach_snapshot["name"], first_coach.name)
        self.assertEqual(high_pass.coach_snapshot["name"], next_coach.name)
        self.assertIsNone(self.campaign.milestones.get(milestone_id="finale").completed_at)


class ExpeditionVariantTests(ExpeditionProgressTests):
    """Route themes, objectives and weekly twists on top of the shared engine.

    Inherits the two-person, two-week fixture (target 400) and its
    ``add_scored_workout`` helper; the parent's own tests are skipped here so
    they do not run twice.
    """

    def run(self, result=None):
        if type(self) is ExpeditionVariantTests and not self._testMethodName.startswith("test_variant_"):
            return None
        return super().run(result)

    def _launch(self, objective="expedition", plan=None, today=None):
        self.campaign.objective = objective
        self.campaign.enabled = True
        self.campaign.save()
        today = today or self.start_date
        recompute_expedition_progress(self.campaign, today=today)
        self.campaign.refresh_from_db()
        if plan is not None:
            ExpeditionCampaign.objects.filter(pk=self.campaign.pk).update(twist_plan=plan)
            self.campaign.refresh_from_db()
        return self.campaign

    def _api(self, user, today):
        client = APIClient()
        client.force_authenticate(user)
        with mock.patch("competition.expedition_api.timezone.localdate", return_value=today):
            return client.get(reverse("competition-expedition", args=[self.competition.pk]))

    # --- themes -----------------------------------------------------------
    def test_variant_theme_rotates_per_organizer_and_freezes_at_launch(self):
        from .expedition_variants import ROUTE_THEME_ORDER, pick_route_theme

        self.assertEqual(self.campaign.route_theme, "summit")  # first route of this organizer
        self.assertEqual(pick_route_theme(self.competition, previous_themes=["summit"]), "ocean")
        self.assertEqual(pick_route_theme(self.competition, previous_themes=["relay", "space", "desert", "ocean", "summit"]), "summit")
        # A rematch (another challenge by the same owner) gets the next route.
        rematch = Competition.objects.create(
            owner=self.owner, name="Shared Route II",
            start_date=self.end_date + datetime.timedelta(days=1), end_date=self.end_date + datetime.timedelta(days=14),
        )
        second = ExpeditionCampaign.objects.create(competition=rematch)
        self.assertEqual(second.route_theme, ROUTE_THEME_ORDER[1])
        # Locked campaigns keep their theme and objective even if edited.
        self._launch()
        self.campaign.route_theme = "space"
        self.campaign.objective = "treasure"
        self.campaign.save()
        self.campaign.refresh_from_db()
        self.assertEqual((self.campaign.route_theme, self.campaign.objective), ("summit", "expedition"))

    def test_variant_api_names_landmarks_after_the_theme(self):
        ExpeditionCampaign.objects.filter(pk=self.campaign.pk).update(route_theme="ocean")
        self.campaign.refresh_from_db()
        self._launch()
        payload = self._api(self.owner, self.start_date).json()
        self.assertEqual(payload["route_theme"], "ocean")
        self.assertEqual(payload["route_title"], "Ocean crossing")
        self.assertEqual([m["title"] for m in payload["milestones"]], ["Harbour", "Open water", "Storm belt", "Far shore"])
        self.assertEqual(payload["milestones"][0]["story"], "Lines cast off. The harbour shrinks behind the crew.")
        self.assertIsNone(payload["milestones"][1]["story"])  # not reached yet
        self.assertEqual(payload["objective"], "expedition")
        self.assertEqual(len(payload["objective_help"]), 3)

    # --- twists -----------------------------------------------------------
    def test_variant_twist_plan_is_dealt_once_at_launch_from_inner_full_weeks(self):
        from .expedition import _score_periods
        from .expedition_variants import build_twist_plan

        # Two-week challenge: no inner full week -> no twists.
        self._launch()
        self.assertEqual(self.campaign.twist_plan, [])
        # Five full weeks: three inner ones -> weather, rope, shortcut on distinct weeks.
        periods = list(_score_periods(self.start_date, self.start_date + datetime.timedelta(days=34)))
        plan = build_twist_plan(periods, participant_count=2, seed=42)
        self.assertEqual(sorted(item["kind"] for item in plan), sorted(["rope", "shortcut", plan[0]["kind"] if plan[0]["kind"] in ("storm", "rest") else next(i["kind"] for i in plan if i["kind"] in ("storm", "rest"))]))
        self.assertEqual(len({item["week_start"] for item in plan}), 3)
        inner = {p[0].isoformat() for p in periods[1:-1]}
        self.assertTrue(all(item["week_start"] in inner for item in plan))
        self.assertEqual(plan, build_twist_plan(periods, participant_count=2, seed=42))  # deterministic
        # Solo crews never get a rope week.
        self.assertNotIn("rope", [i["kind"] for i in build_twist_plan(periods, participant_count=1, seed=42)])

    def test_variant_storm_and_rest_weeks_change_the_ring_not_the_route(self):
        from .expedition import expedition_crew_summary

        week_two = self.start_date + datetime.timedelta(days=7)
        self._launch(plan=[{"week_start": week_two.isoformat(), "kind": "storm"}])
        self.add_scored_workout(self.owner, week_two, 140)
        today = week_two
        progress = recompute_expedition_progress(self.campaign, user_id=self.owner.pk, today=today)
        # Storm week: up to 150 count (140 kept), target still 400.
        self.assertEqual(progress["personal_points"], Decimal("140.00"))
        self.assertEqual(progress["target_points"], Decimal("400.00"))
        crew = expedition_crew_summary(self.campaign, progress, today=today, user_id=self.owner.pk)
        self.assertEqual(crew["weekly_cap_per_person"], 150.0)
        self.assertEqual(crew["twists"]["active"]["kind"], "storm")
        self.assertIn("Bigger ring", crew["twists"]["active"]["coach_line"])
        # Rest week halves the ring.
        ExpeditionCampaign.objects.filter(pk=self.campaign.pk).update(twist_plan=[{"week_start": week_two.isoformat(), "kind": "rest"}])
        self.campaign.refresh_from_db()
        progress = recompute_expedition_progress(self.campaign, user_id=self.owner.pk, today=today)
        self.assertEqual(progress["personal_points"], Decimal("50.00"))

    def test_variant_rope_week_counts_only_days_the_crew_moved_together(self):
        week_two = self.start_date + datetime.timedelta(days=7)
        self._launch(plan=[{"week_start": week_two.isoformat(), "kind": "rope"}])
        self.add_scored_workout(self.owner, week_two, 30)                                   # alone -> dropped
        self.add_scored_workout(self.owner, week_two + datetime.timedelta(days=1), 40)      # together -> counts
        self.add_scored_workout(self.teammate, week_two + datetime.timedelta(days=1), 25)
        progress = recompute_expedition_progress(self.campaign, user_id=self.owner.pk, today=week_two + datetime.timedelta(days=2))
        self.assertEqual(progress["personal_points"], Decimal("40.00"))
        self.assertEqual(progress["earned_points"], Decimal("65.00"))

    def test_variant_shortcut_vote_moves_the_next_landmark(self):
        week_two = self.start_date + datetime.timedelta(days=7)
        self._launch(plan=[{"week_start": week_two.isoformat(), "kind": "shortcut"}])
        crossing_before = self.campaign.milestones.get(milestone_id="high-pass")
        client = APIClient()
        client.force_authenticate(self.owner)
        url = reverse("competition-expedition-shortcut-vote", args=[self.competition.pk])
        with mock.patch("competition.expedition_api.timezone.localdate", return_value=self.start_date):
            self.assertEqual(client.post(url, {"choice": "ridge"}).status_code, 409)  # not vote week yet
        with mock.patch("competition.expedition_api.timezone.localdate", return_value=week_two):
            self.assertEqual(client.post(url, {"choice": "sideways"}).status_code, 400)
            first = client.post(url, {"choice": "ridge"}).json()
            self.assertEqual((first["ridge_votes"], first["valley_votes"], first["result"]), (1, 0, None))
            client.force_authenticate(self.teammate)
            second = client.post(url, {"choice": "ridge"}).json()
        # Everyone voted -> decided immediately: next open landmark (river crossing) moves.
        self.assertEqual((second["result"], second["milestone_id"]), ("ridge", "river-crossing"))
        crossing = self.campaign.milestones.get(milestone_id="river-crossing")
        self.assertEqual(crossing.progress_fraction, Decimal("0.3000"))
        self.assertEqual(crossing.opens_on, self.start_date)  # 3 days earlier, floored at the start
        # Later syncs keep the ridge instead of resetting to the planned route.
        recompute_expedition_progress(self.campaign, today=week_two + datetime.timedelta(days=1))
        self.assertEqual(self.campaign.milestones.get(milestone_id="river-crossing").progress_fraction, Decimal("0.3000"))
        self.assertEqual(self.campaign.milestones.get(milestone_id="high-pass").progress_fraction, crossing_before.progress_fraction)
        payload = self._api(self.owner, week_two + datetime.timedelta(days=1)).json()
        self.assertEqual(payload["twists"]["shortcut"]["result"], "ridge")
        self.assertEqual(payload["twists"]["shortcut"]["your_vote"], "ridge")

    def test_variant_shortcut_tie_or_silence_keeps_the_valley(self):
        from .expedition import _score_periods, settle_shortcut
        from .expedition_variants import decide_shortcut

        self.assertEqual(decide_shortcut({}, 2), "valley")
        self.assertEqual(decide_shortcut({"1": "ridge", "2": "valley"}, 2), "valley")
        week_two = self.start_date + datetime.timedelta(days=7)
        self._launch(plan=[{"week_start": week_two.isoformat(), "kind": "shortcut"}])
        periods = list(_score_periods(self.start_date, self.end_date))
        # Vote week over, nobody voted: valley, route untouched.
        state = settle_shortcut(self.campaign, periods, {self.owner.pk, self.teammate.pk}, today=week_two + datetime.timedelta(days=7))
        self.assertEqual(state["shortcut"]["result"], "valley")
        self.assertEqual(self.campaign.milestones.get(milestone_id="river-crossing").progress_fraction, Decimal("0.2500"))

    # --- objectives -------------------------------------------------------
    def test_variant_rescue_run_stamps_only_landmarks_beaten_before_their_date(self):
        from .expedition import expedition_crew_summary

        self._launch(objective="rescue")
        # River crossing target is day 4 (13 days / 3 rounded); reach it late.
        self.add_scored_workout(self.owner, self.start_date, 100)
        late = self.start_date + datetime.timedelta(days=6)
        progress = recompute_expedition_progress(self.campaign, today=late)
        crossing = self.campaign.milestones.get(milestone_id="river-crossing")
        self.assertIsNotNone(crossing.completed_at)
        self.assertFalse(crossing.stamped)  # the storm got there first
        self.assertTrue(self.campaign.milestones.get(milestone_id="trailhead").stamped)
        crew = expedition_crew_summary(self.campaign, progress, today=late)
        self.assertEqual(crew["storm_percent"], max(0.0, crew["pace_percent"] - 12.0))
        payload = self._api(self.owner, late).json()
        self.assertEqual([m["stamped"] for m in payload["milestones"]][:2], [True, False])
        self.assertEqual(payload["objective_title"], "Rescue run")

    def test_variant_expedition_objective_always_stamps(self):
        self._launch()
        self.add_scored_workout(self.owner, self.start_date, 100)
        recompute_expedition_progress(self.campaign, today=self.start_date + datetime.timedelta(days=6))
        self.assertTrue(self.campaign.milestones.get(milestone_id="river-crossing").stamped)

    def test_variant_base_camp_counts_tents_not_distance(self):
        self._launch(objective="basecamp")
        # Week 1 held (>= 60% of 200 = 120), week 2 nothing.
        self.add_scored_workout(self.owner, self.start_date, 70)
        self.add_scored_workout(self.teammate, self.start_date, 60)
        week_two = self.start_date + datetime.timedelta(days=7)
        progress = recompute_expedition_progress(self.campaign, today=week_two)
        # 1 tent of 2 weeks -> 50% camp progress although the route share is 130/400.
        self.assertEqual(progress["progress_percent"], Decimal("50.0"))
        self.assertEqual(progress["route_percent"], Decimal("32.5"))
        payload = self._api(self.owner, week_two).json()
        self.assertEqual(payload["camp"]["tents"], 1)
        self.assertEqual(payload["camp"]["held_weeks"], 1)
        self.assertFalse(payload["camp"]["this_week"]["held"])
        self.assertEqual(payload["camp"]["this_week"]["needed_points"], 120.0)
        # Landmarks follow the tents: 25% river crossing reached with one tent.
        self.assertEqual(payload["milestones"][1]["status"], "completed")
        # A missed completed week takes a tent away, never below zero.
        after = recompute_expedition_progress(self.campaign, today=self.end_date + datetime.timedelta(days=1))
        self.assertEqual(after["progress_percent"], Decimal("0.0"))

    def test_variant_treasure_hunt_hides_landmarks_until_found(self):
        self._launch(objective="treasure")
        self.add_scored_workout(self.owner, self.start_date, 100)
        today = self.start_date + datetime.timedelta(days=5)
        recompute_expedition_progress(self.campaign, today=today)
        payload = self._api(self.owner, today).json()
        found = [m for m in payload["milestones"] if not m["hidden"]]
        hidden = [m for m in payload["milestones"] if m["hidden"]]
        self.assertEqual([m["milestone_id"] for m in found], ["trailhead", "river-crossing"])
        self.assertEqual([m["title"] for m in hidden], ["?", "?"])
        self.assertTrue(all(m["story"] is None for m in hidden))
        self.assertEqual(found[1]["story"], "Cold water, linked arms - everyone across.")
        self.assertEqual(payload["objective_tagline"], "Find out what's out there.")


class OrganizerExpeditionSettingsTests(TestCase):
    """Challenge owners switch the Expedition on and pick objective/theme
    from the challenge form; participants only read the settings."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.owner = CustomUser.objects.create_user(email="settings-owner@example.com", password="test-pw")
        self.member = CustomUser.objects.create_user(email="settings-member@example.com", password="test-pw")
        today = timezone.localdate()
        self.start_date = today + datetime.timedelta(days=10)
        self.end_date = today + datetime.timedelta(days=39)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def test_owner_creates_a_challenge_with_a_treasure_hunt_on_the_desert_route(self):
        response = self.client.post("/api/competition/", {
            "name": "Autumn", "start_date": self.start_date.isoformat(), "end_date": self.end_date.isoformat(),
            "expedition_enabled": True, "expedition_objective": "treasure", "expedition_theme": "desert",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["expedition_enabled"], body["expedition_objective"], body["expedition_theme"], body["expedition_locked"]),
                         (True, "treasure", "desert", False))
        campaign = ExpeditionCampaign.objects.get(competition_id=body["id"])
        self.assertTrue(campaign.enabled)
        self.assertEqual((campaign.objective, campaign.route_theme), ("treasure", "desert"))
        self.assertEqual(campaign.milestones.count(), 4, "synchronised right away so the Trail tab is not empty")

    def test_challenges_without_a_campaign_read_as_disabled_defaults(self):
        response = self.client.post("/api/competition/", {
            "name": "Plain", "start_date": self.start_date.isoformat(), "end_date": self.end_date.isoformat(),
        }, format="json")
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual((body["expedition_enabled"], body["expedition_objective"], body["expedition_theme"]), (False, "expedition", ""))
        self.assertFalse(ExpeditionCampaign.objects.filter(competition_id=body["id"]).exists())

    def test_owner_changes_objective_before_launch_and_a_blank_theme_rotates(self):
        competition = Competition.objects.create(owner=self.owner, name="Edit", start_date=self.start_date, end_date=self.end_date)
        self.owner.my_competitions.add(competition)
        response = self.client.patch(f"/api/competition/{competition.pk}/", {
            "expedition_enabled": True, "expedition_objective": "basecamp", "expedition_theme": "",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        campaign = ExpeditionCampaign.objects.get(competition=competition)
        self.assertEqual(campaign.objective, "basecamp")
        self.assertEqual(campaign.route_theme, "summit", "first route for this organizer")
        self.assertEqual(response.json()["expedition_theme"], "summit")

        response = self.client.patch(f"/api/competition/{competition.pk}/", {"expedition_objective": "rescue"}, format="json")
        self.assertEqual(response.status_code, 200)
        campaign.refresh_from_db()
        self.assertEqual(campaign.objective, "rescue")

    def test_objective_and_theme_are_frozen_once_the_route_is_locked(self):
        competition = Competition.objects.create(owner=self.owner, name="Locked", start_date=self.start_date, end_date=self.end_date)
        self.owner.my_competitions.add(competition)
        campaign = ExpeditionCampaign.objects.create(competition=competition, enabled=True, objective="rescue", route_theme="space")
        synchronize_expedition(campaign, today=self.start_date)
        campaign.refresh_from_db()
        self.assertIsNotNone(campaign.locked_at)

        response = self.client.patch(f"/api/competition/{competition.pk}/", {
            "expedition_objective": "treasure", "expedition_theme": "ocean",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        campaign.refresh_from_db()
        self.assertEqual((campaign.objective, campaign.route_theme), ("rescue", "space"))
        self.assertEqual((body["expedition_objective"], body["expedition_theme"], body["expedition_locked"]), ("rescue", "space", True))

        # Switching the Expedition off still works after launch (hides it, keeps progress).
        response = self.client.patch(f"/api/competition/{competition.pk}/", {"expedition_enabled": False}, format="json")
        self.assertEqual(response.status_code, 200)
        campaign.refresh_from_db()
        self.assertFalse(campaign.enabled)
        self.assertEqual(campaign.milestones.count(), 4)

    def test_participants_cannot_change_expedition_settings(self):
        competition = Competition.objects.create(owner=self.owner, name="Guarded", start_date=self.start_date, end_date=self.end_date)
        competition.user.add(self.owner, self.member)
        client = APIClient()
        client.force_authenticate(self.member)
        response = client.patch(f"/api/competition/{competition.pk}/", {"expedition_enabled": True}, format="json")
        self.assertIn(response.status_code, (403, 404))
        self.assertFalse(ExpeditionCampaign.objects.filter(competition=competition).exists())
        listed = client.get("/api/competition/").json()
        row = next(item for item in listed if item["id"] == competition.pk)
        self.assertEqual(row["expedition_enabled"], False)

    def test_rejects_unknown_objective(self):
        response = self.client.post("/api/competition/", {
            "name": "Bad", "start_date": self.start_date.isoformat(), "end_date": self.end_date.isoformat(),
            "expedition_enabled": True, "expedition_objective": "moon-landing",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("expedition_objective", response.json())

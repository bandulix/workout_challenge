"""Duels: scoring windows, grace, ties, expiry, privacy, and pings."""

import datetime
from decimal import Decimal
from unittest import mock

from django.db.models import Q, Sum
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from competition.duels import (
    GRACE_HOURS,
    DuelError,
    _notify,
    compose_commentary,
    create_duel,
    in_quiet_hours,
    live_scores,
    owes_line,
    score_athlete,
    serialize_duel,
    settle_due_duels,
    settle_duel,
)
from competition.models import Duel, DuelNote, DuelPing, Points
from competition.scorer import quantize_points
from custom_user.models import CustomUser
from drill_instructor.models import DogTag, DrillInstructorConfig, DrillInstructorMessage, DrillInstructorPersona
from workouts.models import Workout


def _silence():
    started = []
    for target in (
        "competition.scorer.trigger_recalc_points",
        "custom_user.models.verify_email.apply_async",
        "drill_instructor.tasks.post_workout_comment.delay",
    ):
        patcher = mock.patch(target)
        patcher.start()
        started.append(patcher)
    return started


class DuelSetup(TestCase):
    def setUp(self):
        self._patches = _silence()
        self.client = APIClient()
        self.alice = CustomUser.objects.create_user(
            email="alice-duel@example.com", password="test-pw", first_name="Alice", username="Alice",
        )
        self.bob = CustomUser.objects.create_user(
            email="bob-duel@example.com", password="test-pw", first_name="Bob", username="Bob",
        )
        self.cara = CustomUser.objects.create_user(
            email="cara-duel@example.com", password="test-pw", first_name="Cara", username="Cara",
        )
        self.stranger = CustomUser.objects.create_user(
            email="stranger-duel@example.com", password="test-pw", first_name="Sam", username="Sam",
        )
        from competition.models import Competition
        self.cup = Competition.objects.create(
            owner=self.alice,
            name="Duel Cup",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2027, 1, 31),
        )
        self.cup.user.add(self.bob, self.cara)
        self.min_goal = self.cup.activitygoal_set.get(metric="min")
        self.client.force_authenticate(self.alice)

    def tearDown(self):
        for patcher in self._patches:
            patcher.stop()

    def waking(self, hour=10, day=None):
        local = timezone.localtime()
        if day is not None:
            local = local.replace(year=day.year, month=day.month, day=day.day)
        return local.replace(hour=hour, minute=0, second=0, microsecond=0)

    def log(self, user, when, sport="Run", minutes=30):
        workout = Workout(
            user=user,
            sport_type=sport,
            start_datetime=when,
            duration=datetime.timedelta(minutes=minutes),
            intensity_category=2,
        )
        workout.save(score=True)
        return workout

    def active(self, start, end, **kwargs):
        challenger = kwargs.pop("challenger", self.alice)
        opponent = kwargs.pop("opponent", self.bob)
        return Duel.objects.create(
            competition=self.cup,
            challenger=challenger,
            opponent=opponent,
            proposed_by=challenger,
            awaiting=opponent,
            status=Duel.STATUS_ACTIVE,
            duration_days=kwargs.pop("duration_days", 7),
            metric=kwargs.pop("metric", Duel.METRIC_POINTS),
            sport_type=kwargs.pop("sport_type", ""),
            forfeit=kwargs.pop("forfeit", ""),
            respond_by=start,
            starts_at=start,
            ends_at=end,
            grace_until=end + datetime.timedelta(hours=GRACE_HOURS),
            pinged_accepted=True,
            **kwargs,
        )

    def board_sum(self, user, start, end, **extra):
        qs = Points.objects.filter(
            Q(goal__competition=self.cup) | Q(award__competition=self.cup),
            workout__user=user,
            workout__start_datetime__gte=start,
            workout__start_datetime__lt=end,
        )
        if extra:
            qs = qs.filter(**extra)
        return quantize_points(qs.aggregate(total=Sum("points_capped"))["total"] or 0)

    def enable_push(self):
        persona = DrillInstructorPersona.objects.create(
            name=f"Sergeant {self.cup.pk}",
            system_prompt="Short playful coach. Never cruel.",
            language="en",
            avatar="sergeant",
        )
        return DrillInstructorConfig.objects.create(
            competition=self.cup,
            persona=persona,
            enabled=True,
            send_push_on_activity=True,
        )


class ScoringTests(DuelSetup):
    def test_points_match_the_leaderboard_slice(self):
        when = self.waking(hour=12, day=datetime.date(2026, 6, 15))
        self.log(self.alice, when, "Run", 45)
        self.log(self.bob, when, "Tennis", 20)
        start, end = when - datetime.timedelta(hours=1), when + datetime.timedelta(hours=2)
        duel = self.active(start, end)
        self.assertEqual(score_athlete(duel, self.alice.pk), self.board_sum(self.alice, start, end))
        self.assertEqual(score_athlete(duel, self.bob.pk), self.board_sum(self.bob, start, end))
        self.assertGreater(score_athlete(duel, self.alice.pk), 0)

    def test_minutes_and_sport_use_the_same_rows(self):
        when = self.waking(hour=12, day=datetime.date(2026, 6, 16))
        self.log(self.alice, when, "Run", 40)
        self.log(self.alice, when + datetime.timedelta(hours=1), "Tennis", 40)
        start, end = when - datetime.timedelta(minutes=30), when + datetime.timedelta(hours=3)
        points = self.active(start, end)
        minutes = self.active(start, end, metric=Duel.METRIC_MINUTES)
        running = self.active(start, end, metric=Duel.METRIC_SPORT, sport_type="Run")
        self.assertEqual(
            score_athlete(minutes, self.alice.pk),
            self.board_sum(self.alice, start, end, goal__metric="min"),
        )
        self.assertEqual(
            score_athlete(running, self.alice.pk),
            self.board_sum(self.alice, start, end, workout__sport_type="Run"),
        )
        self.assertLess(score_athlete(minutes, self.alice.pk), score_athlete(points, self.alice.pk))
        self.assertLess(score_athlete(running, self.alice.pk), score_athlete(points, self.alice.pk))

    def test_timezone_window_and_local_days(self):
        timezone.activate("Pacific/Auckland")
        self.addCleanup(timezone.deactivate)
        start = timezone.make_aware(datetime.datetime(2026, 6, 15, 0, 0), timezone.get_current_timezone())
        end = start + datetime.timedelta(days=2)
        evening = datetime.datetime(2026, 6, 15, 11, 30, tzinfo=datetime.timezone.utc)
        next_morning = datetime.datetime(2026, 6, 15, 12, 30, tzinfo=datetime.timezone.utc)
        self.assertEqual(timezone.localtime(evening).date(), datetime.date(2026, 6, 15))
        self.assertEqual(timezone.localtime(next_morning).date(), datetime.date(2026, 6, 16))
        for when, points in ((evening, 10), (next_morning, 4), (end, 100), (start - datetime.timedelta(seconds=1), 50)):
            workout = Workout(
                user=self.alice, sport_type="Run", start_datetime=when,
                duration=datetime.timedelta(minutes=20), intensity_category=2,
            )
            workout.save(score=False)
            Points.objects.create(
                goal=self.min_goal, workout=workout,
                points_raw=Decimal(points), points_capped=Decimal(points),
            )
        duel = self.active(start, end)
        self.assertEqual(score_athlete(duel, self.alice.pk), Decimal("14.00"))
        payload = serialize_duel(duel, self.alice, detailed=True)
        by_day = {row["date"]: row["you"] for row in payload["daily"]}
        self.assertEqual(by_day["2026-06-15"], 10.0)
        self.assertEqual(by_day["2026-06-16"], 4.0)

    def test_grace_keeps_late_syncs_then_freezes(self):
        now = self.waking(hour=15)
        end = now - datetime.timedelta(hours=2)
        start = end - datetime.timedelta(days=3)
        duel = self.active(start, end)
        self.assertEqual(score_athlete(duel, self.alice.pk), Decimal("0.00"))
        inside = end - datetime.timedelta(hours=1)
        workout = Workout(
            user=self.alice, sport_type="Run", start_datetime=inside,
            duration=datetime.timedelta(minutes=30), intensity_category=2,
        )
        workout.save(score=False)
        Points.objects.create(
            goal=self.min_goal, workout=workout, points_raw=Decimal("12.50"), points_capped=Decimal("12.50"),
        )
        self.assertEqual(live_scores(duel)[0], Decimal("12.50"))
        settle_duel(duel, now=duel.grace_until + datetime.timedelta(minutes=1))
        duel.refresh_from_db()
        self.assertEqual(duel.status, Duel.STATUS_COMPLETED)
        self.assertEqual(duel.challenger_score, Decimal("12.50"))
        late = Workout(
            user=self.alice, sport_type="Run", start_datetime=inside + datetime.timedelta(minutes=5),
            duration=datetime.timedelta(minutes=30), intensity_category=2,
        )
        late.save(score=False)
        Points.objects.create(
            goal=self.min_goal, workout=late, points_raw=Decimal("9.00"), points_capped=Decimal("9.00"),
        )
        self.assertEqual(live_scores(duel)[0], Decimal("12.50"))
        self.assertEqual(score_athlete(duel, self.alice.pk), Decimal("21.50"))

    def test_tie_and_expiry(self):
        now = self.waking(hour=11)
        end = now - datetime.timedelta(hours=8)
        start = end - datetime.timedelta(days=3)
        duel = self.active(start, end, forfeit="Loser buys the beers")
        for user in (self.alice, self.bob):
            workout = Workout(
                user=user, sport_type="Run", start_datetime=start + datetime.timedelta(hours=1),
                duration=datetime.timedelta(minutes=20), intensity_category=2,
            )
            workout.save(score=False)
            Points.objects.create(
                goal=self.min_goal, workout=workout, points_raw=Decimal("8"), points_capped=Decimal("8"),
            )
        settle_duel(duel, now=duel.grace_until + datetime.timedelta(minutes=1))
        duel.refresh_from_db()
        self.assertEqual(duel.result, Duel.RESULT_TIE)
        payload = serialize_duel(duel, self.alice, detailed=True)
        self.assertEqual(payload["forfeit_line"], "")
        self.assertFalse(payload["can_mark_paid"])
        pending = create_duel(
            competition=self.cup, challenger=self.alice, opponent_id=self.cara.pk, now=now,
        )
        pending.respond_by = now - datetime.timedelta(hours=1)
        pending.save(update_fields=["respond_by"])
        settle_due_duels(now=now)
        pending.refresh_from_db()
        self.assertEqual(pending.status, Duel.STATUS_EXPIRED)


class PrivacyAndFlowTests(DuelSetup):
    def test_only_the_two_duelists_see_the_forfeit(self):
        now = self.waking()
        created = self.client.post("/api/competition/%s/duels/" % self.cup.pk, {
            "opponent_id": self.bob.pk,
            "duration_days": 7,
            "metric": "points",
            "forfeit": "Loser buys the beers",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        duel_id = created.json()["id"]
        self.client.force_authenticate(self.cara)
        hidden = self.client.get(f"/api/duels/{duel_id}/")
        self.assertEqual(hidden.status_code, 404)
        listing = self.client.get("/api/duels/").json()
        self.assertEqual(listing["results"], [])
        self.client.force_authenticate(self.stranger)
        denied = self.client.post("/api/competition/%s/duels/" % self.cup.pk, {
            "opponent_id": self.bob.pk,
        }, format="json")
        self.assertEqual(denied.status_code, 404)
        self.client.force_authenticate(self.bob)
        declined = self.client.post(f"/api/duels/{duel_id}/respond/", {"action": "decline"}, format="json")
        self.assertEqual(declined.status_code, 200)
        self.assertEqual(declined.json()["status"], "declined")
        again = create_duel(competition=self.cup, challenger=self.alice, opponent_id=self.bob.pk, now=now)
        countered = self.client.post(f"/api/duels/{again.pk}/respond/", {
            "action": "counter",
            "duration_days": 3,
            "forfeit": "Loser donates 500 THB to Thai.GER",
        }, format="json")
        self.assertEqual(countered.status_code, 200, countered.content)
        body = countered.json()
        self.assertEqual(body["status"], "countered")
        self.assertEqual(body["duration_days"], 3)
        self.assertTrue(body["awaiting_you"] is False)
        self.assertIn("500 THB", body["forfeit"])
        self.client.force_authenticate(self.alice)
        accepted = self.client.post(f"/api/duels/{again.pk}/respond/", {"action": "accept"}, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.json()["status"], "active")
        self.assertTrue(DogTag.objects.filter(user=self.alice, slug="first_duel").exists())
        self.assertTrue(DogTag.objects.filter(user=self.bob, slug="first_duel").exists())

    def test_block_open_limit_and_forfeit_confirmation(self):
        now = self.waking()
        self.client.force_authenticate(self.bob)
        blocked = self.client.post("/api/duels/block/", {"user_id": self.alice.pk}, format="json")
        self.assertEqual(blocked.status_code, 200)
        self.client.force_authenticate(self.alice)
        refused = self.client.post("/api/competition/%s/duels/" % self.cup.pk, {
            "opponent_id": self.bob.pk,
        }, format="json")
        self.assertEqual(refused.status_code, 403)
        self.client.force_authenticate(self.bob)
        self.client.delete("/api/duels/block/", {"user_id": self.alice.pk}, format="json")
        dee = CustomUser.objects.create_user(
            email="dee-duel@example.com", password="test-pw", first_name="Dee", username="Dee",
        )
        self.cup.user.add(dee)
        first = create_duel(competition=self.cup, challenger=self.alice, opponent_id=self.bob.pk, now=now)
        second = create_duel(competition=self.cup, challenger=self.alice, opponent_id=self.cara.pk, now=now)
        with self.assertRaises(DuelError) as raised:
            create_duel(competition=self.cup, challenger=self.alice, opponent_id=dee.pk, now=now)
        self.assertEqual(raised.exception.status, 409)
        self.assertIn("two open", raised.exception.message)
        self.assertNotEqual(first.pk, second.pk)

        end = now - datetime.timedelta(hours=8)
        finished = self.active(
            end - datetime.timedelta(days=3), end,
            forfeit="Loser buys the beers",
            challenger=self.bob, opponent=self.alice,
        )
        workout = Workout(
            user=self.alice, sport_type="Run", start_datetime=finished.starts_at + datetime.timedelta(hours=1),
            duration=datetime.timedelta(minutes=30), intensity_category=2,
        )
        workout.save(score=False)
        Points.objects.create(
            goal=self.min_goal, workout=workout, points_raw=Decimal("5"), points_capped=Decimal("5"),
        )
        settle_duel(finished, now=finished.grace_until + datetime.timedelta(minutes=1))
        finished.refresh_from_db()
        self.assertEqual(finished.result, Duel.RESULT_OPPONENT)
        self.assertEqual(owes_line(self.bob, finished.forfeit), "Bob owes: the beers")
        self.client.force_authenticate(self.alice)
        too_soon = self.client.post(f"/api/duels/{finished.pk}/forfeit/", {"action": "confirm"}, format="json")
        self.assertEqual(too_soon.status_code, 400)
        self.client.force_authenticate(self.bob)
        marked = self.client.post(f"/api/duels/{finished.pk}/forfeit/", {"action": "mark_paid"}, format="json")
        self.assertEqual(marked.status_code, 200, marked.content)
        self.assertTrue(marked.json()["forfeit_marked"])
        self.client.force_authenticate(self.alice)
        confirmed = self.client.post(f"/api/duels/{finished.pk}/forfeit/", {"action": "confirm"}, format="json")
        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        self.assertTrue(confirmed.json()["forfeit_confirmed"])
        self.assertEqual(confirmed.json()["forfeit_line"], "Bob owes: the beers")

    def test_feed_post_is_opt_in_and_hides_a_private_forfeit(self):
        self.enable_push()
        now = self.waking()
        end = now - datetime.timedelta(hours=8)
        quiet = self.active(end - datetime.timedelta(days=2), end, forfeit="Loser buys the beers")
        quiet.challenger_feed_opt_in = True
        quiet.opponent_feed_opt_in = True
        quiet.save(update_fields=["challenger_feed_opt_in", "opponent_feed_opt_in"])
        settle_duel(quiet, now=quiet.grace_until + datetime.timedelta(minutes=1))
        message = DrillInstructorMessage.objects.get(kind=DrillInstructorMessage.KIND_DUEL)
        self.assertNotIn("owes", message.body.lower())
        self.assertNotIn("beers", message.body.lower())
        self.assertNotIn("lost", message.body.lower())
        public = self.active(end - datetime.timedelta(days=2), end, forfeit="Loser buys the beers")
        public.challenger_feed_opt_in = True
        public.opponent_feed_opt_in = True
        public.challenger_forfeit_public = True
        public.opponent_forfeit_public = True
        public.save()
        settle_duel(public, now=public.grace_until + datetime.timedelta(minutes=1))
        bodies = list(DrillInstructorMessage.objects.filter(kind="duel").values_list("body", flat=True))
        self.assertTrue(any("Loser buys the beers" in body for body in bodies))

    def test_dog_tag_series(self):
        from competition.duels import _award_tags_for_result

        now = self.waking()
        def finish(winner, loser, when):
            row = self.active(
                when - datetime.timedelta(days=3), when,
                challenger=winner, opponent=loser,
            )
            row.status = Duel.STATUS_COMPLETED
            row.result = Duel.RESULT_CHALLENGER
            row.finalized_at = when
            row.challenger_score = Decimal("2")
            row.opponent_score = Decimal("1")
            row.save()
            return row

        loss = self.active(now - datetime.timedelta(days=30), now - datetime.timedelta(days=27), challenger=self.bob, opponent=self.alice)
        loss.status = Duel.STATUS_COMPLETED
        loss.result = Duel.RESULT_CHALLENGER
        loss.finalized_at = now - datetime.timedelta(days=27)
        loss.save()
        revenge = finish(self.alice, self.bob, now - datetime.timedelta(days=20))
        _award_tags_for_result(revenge)
        self.assertTrue(DogTag.objects.filter(user=self.alice, slug="duel_revenge").exists())
        third = None
        for days in (14, 10, 6):
            third = finish(self.alice, self.bob, now - datetime.timedelta(days=days))
            _award_tags_for_result(third)
        self.assertTrue(DogTag.objects.filter(user=self.alice, slug="duel_three_wins").exists())
        fifth = finish(self.alice, self.bob, now - datetime.timedelta(days=2))
        _award_tags_for_result(fifth)
        self.assertTrue(DogTag.objects.filter(user=self.alice, slug="duel_streak_five").exists())


class PingTests(DuelSetup):
    def test_quiet_hours_and_opt_in_and_rate_limit(self):
        night = self.waking(hour=23)
        morning = self.waking(hour=10)
        self.assertTrue(in_quiet_hours(night))
        self.assertFalse(in_quiet_hours(morning))
        self.enable_push()
        end = morning + datetime.timedelta(hours=20)
        duel = self.active(morning - datetime.timedelta(days=6), end)
        duel.pinged_accepted = False
        duel.save(update_fields=["pinged_accepted"])
        with mock.patch("push_notifications.sender.send_push_to_user") as push:
            settle_duel(duel, now=night)
            duel.refresh_from_db()
            self.assertFalse(duel.pinged_accepted)
            self.assertEqual(push.call_count, 0)
            settle_duel(duel, now=morning)
            duel.refresh_from_db()
            self.assertTrue(duel.pinged_accepted)
            self.assertGreaterEqual(push.call_count, 2)
            self.assertGreaterEqual(DuelPing.objects.filter(duel=duel, kind="accepted").count(), 2)
            again = _notify(
                self.alice, duel=duel, kind="lead", title="Duel lead", body="Lead", now=morning,
            )
            second = _notify(
                self.alice, duel=duel, kind="lead", title="Duel lead", body="Lead", now=morning,
            )
            self.assertTrue(again)
            self.assertFalse(second)

    def test_commentary_falls_back_without_a_model(self):
        now = self.waking()
        duel = self.active(now - datetime.timedelta(days=1), now + datetime.timedelta(days=6))
        persona = DrillInstructorPersona.objects.create(
            name=f"Zen {self.cup.pk}",
            system_prompt="Calm.",
            language="de",
        )
        DrillInstructorConfig.objects.create(
            competition=self.cup, persona=persona, enabled=True, send_push_on_activity=False,
        )
        line = compose_commentary(duel, DuelNote.KIND_ACCEPTED)
        self.assertIn("@Alice", line)
        self.assertIn("@Bob", line)

    def test_settle_task_is_scheduled(self):
        from django_celery_beat.models import PeriodicTask
        task = PeriodicTask.objects.get(name="duel_settle")
        self.assertEqual(task.task, "competition.tasks.settle_duels")
        self.assertTrue(task.enabled)

"""Regression tests for the issues fixed in the codebase review.

Each test pins one concrete defect so it cannot silently return:
Celery duplicate-run guard, stale serializer cache after PATCH, points
quantisation, e-mail duration maths and the Echo mint prompt.
"""
import datetime
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from custom_user.models import CustomUser
from competition.models import Competition
from competition.scorer import quantize_points
from workout_challenge.celery import is_task_already_executing


class CeleryRunningGuardTests(SimpleTestCase):
    """Celery registers fully-qualified task names; callers pass short ones."""

    def _inspect(self, names):
        payload = {"worker@host": [{"name": n} for n in names]}
        inspector = mock.Mock()
        inspector.active.return_value = payload
        return mock.patch("workout_challenge.celery.app.control.inspect", return_value=inspector)

    def test_short_name_matches_fully_qualified_registration(self):
        with self._inspect(["custom_user.point_recalc.recalc_points", "custom_user.point_recalc.recalc_points"]):
            self.assertTrue(is_task_already_executing("recalc_points"))

    def test_unrelated_tasks_do_not_count(self):
        with self._inspect(["custom_user.strava.daily_strava_sync"]):
            self.assertFalse(is_task_already_executing("recalc_points"))

    def test_no_worker_answer_means_nothing_running(self):
        inspector = mock.Mock()
        inspector.active.return_value = None
        with mock.patch("workout_challenge.celery.app.control.inspect", return_value=inspector):
            self.assertFalse(is_task_already_executing("recalc_points"))


class PointsQuantisationTests(SimpleTestCase):
    def test_points_are_two_decimal_decimals(self):
        value = quantize_points(12.3456789)
        self.assertIsInstance(value, Decimal)
        self.assertEqual(value, Decimal("12.35"))

    def test_quantised_value_round_trips_against_stored_decimal(self):
        # The change guards compare computed vs stored; both must agree
        # once the DB has rounded to 2 dp.
        stored = Decimal("12.35")
        self.assertEqual(quantize_points(12.3456789), stored)


class EmailDurationTests(SimpleTestCase):
    def test_weekly_minutes_keep_whole_days(self):
        from custom_user.emails.celery_emails import _duration_minutes
        self.assertEqual(_duration_minutes(datetime.timedelta(hours=25)), 25 * 60)
        self.assertEqual(_duration_minutes(datetime.timedelta(minutes=90)), 90)


class EchoMintPromptTests(SimpleTestCase):
    def test_prompt_interpolates_athlete_name(self):
        from drill_instructor.echoes import _mint_prompt
        config = mock.Mock()
        config.persona = mock.Mock(name="Sarge")
        text = _mint_prompt(config, "Morgan", "running", 12.0, "km", ["longest run"], 3)
        self.assertIn("Morgan", text)
        self.assertNotIn("{athlete}", text)


class CompetitionPatchFreshnessTests(TestCase):
    """PATCHing expedition settings must echo the NEW values, not the
    select_related snapshot loaded before the write."""

    def setUp(self):
        for target in (
            "competition.scorer.trigger_recalc_points",
            "custom_user.models.verify_email.apply_async",
        ):
            patcher = mock.patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.owner = CustomUser.objects.create_user(email="fresh-owner@example.com", password="test-pw")
        today = timezone.localdate()
        self.competition = Competition.objects.create(
            owner=self.owner, name="Fresh",
            start_date=today + datetime.timedelta(days=10), end_date=today + datetime.timedelta(days=39),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def test_patch_response_reflects_new_objective_and_theme(self):
        url = f"/api/competition/{self.competition.pk}/"
        first = self.client.patch(url, {"expedition_enabled": True, "expedition_objective": "rescue", "expedition_theme": "ocean"}, format="json")
        self.assertEqual(first.status_code, 200, first.content)
        second = self.client.patch(url, {"expedition_objective": "basecamp", "expedition_theme": "desert"}, format="json")
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual((second.data["expedition_objective"], second.data["expedition_theme"]), ("basecamp", "desert"))
        fetched = self.client.get(url)
        self.assertEqual((fetched.data["expedition_objective"], fetched.data["expedition_theme"]), ("basecamp", "desert"))

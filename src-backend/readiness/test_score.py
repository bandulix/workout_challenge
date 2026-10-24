"""Readiness score: warm-up, missing data, outliers, time zones."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase

from readiness.schedule import effective_push_minute, in_quiet, push_is_due
from readiness.score import (
    component_hrv,
    component_load,
    deviation_score,
    load_score,
    local_date,
    readiness_date_for_sleep,
    score_day,
)


TODAY = date(2026, 10, 24)


def _days(value, n=7, metric=None):
    rows = []
    for offset in range(1, n + 1):
        item = [TODAY - timedelta(days=offset), value]
        if metric is not None:
            item.append(metric)
        rows.append(tuple(item))
    return rows


class DeviationTests(SimpleTestCase):
    def test_baseline_is_seventy_and_cap_is_forty_percent(self):
        self.assertEqual(deviation_score(0), 70)
        self.assertEqual(deviation_score(-0.18), 48)
        self.assertEqual(deviation_score(-0.80), 20)
        self.assertEqual(deviation_score(0.80), 100)

    def test_load_curve(self):
        self.assertEqual(load_score(0.5), 82)
        self.assertEqual(load_score(0.8), 82)
        self.assertEqual(load_score(1.0), 76)
        self.assertEqual(load_score(1.3), 68)
        self.assertEqual(load_score(1.5), 40)
        self.assertEqual(load_score(2.0), 15)
        self.assertEqual(load_score(3.0), 15)


class ScoreDayTests(SimpleTestCase):
    def test_documented_amber_why_line(self):
        result = score_day(
            today=TODAY,
            hrv=41,
            hrv_metric="rmssd",
            hrv_history=_days(50, metric="rmssd"),
            sleep_minutes=340,
            sleep_history=_days(450),
        )
        self.assertEqual(result.score, 44)
        self.assertEqual(result.band, "amber")
        self.assertEqual(result.why, "HRV 18% below your norm, 5h40 sleep")
        self.assertFalse(result.warming_up)

    def test_outlier_hrv_is_dropped(self):
        result = score_day(
            today=TODAY,
            hrv=400,
            hrv_metric="rmssd",
            hrv_history=_days(50, metric="rmssd"),
            sleep_minutes=450,
            sleep_history=_days(450),
        )
        self.assertNotIn("hrv", result.components)
        self.assertIn("sleep", result.components)

    def test_two_day_warmup_skips_hrv(self):
        part = component_hrv(TODAY, 60, "rmssd", _days(50, n=2, metric="rmssd"))
        self.assertIsNone(part)

    def test_cap_keeps_the_real_percent_in_the_why_line(self):
        result = score_day(
            today=TODAY,
            hrv=10,
            hrv_metric="rmssd",
            hrv_history=_days(50, metric="rmssd"),
        )
        self.assertEqual(result.components["hrv"]["score"], 20)
        self.assertEqual(result.why, "HRV 80% below your norm")

    def test_sdnn_history_does_not_score_rmssd_today(self):
        part = component_hrv(TODAY, 45, "rmssd", _days(50, metric="sdnn"))
        self.assertIsNone(part)

    def test_load_waits_for_fourteen_days(self):
        history = [(TODAY - timedelta(days=offset), 40) for offset in range(1, 10)]
        self.assertIsNone(component_load(TODAY, history))

    def test_no_signals_warms_up(self):
        result = score_day(today=TODAY)
        self.assertIsNone(result.score)
        self.assertTrue(result.warming_up)
        self.assertEqual(result.band, "")

    def test_checkin_alone_is_the_whole_score(self):
        result = score_day(today=TODAY, feel=2)
        self.assertEqual(result.score, 35)
        self.assertEqual(result.band, "red")
        self.assertEqual(result.components["checkin"]["weight"], 100)

    def test_partial_data_renormalises(self):
        result = score_day(
            today=TODAY,
            sleep_minutes=480,
            sleep_history=_days(450),
        )
        self.assertEqual(set(result.components), {"sleep"})
        self.assertEqual(result.band, "green")


class TimezoneTests(SimpleTestCase):
    def test_naive_datetime_is_refused(self):
        with self.assertRaises(ValueError):
            local_date(datetime(2026, 10, 24, 6, 10), ZoneInfo("America/Los_Angeles"))

    def test_sleep_end_follows_the_athlete_zone(self):
        la = ZoneInfo("America/Los_Angeles")
        end = datetime(2026, 10, 24, 6, 10, tzinfo=la)
        self.assertEqual(readiness_date_for_sleep(end, la), date(2026, 10, 24))
        auckland = ZoneInfo("Pacific/Auckland")
        self.assertEqual(readiness_date_for_sleep(end, auckland), date(2026, 10, 25))

    def test_evening_end_belongs_to_the_next_morning(self):
        la = ZoneInfo("America/Los_Angeles")
        end = datetime(2026, 10, 23, 16, 0, tzinfo=la)
        self.assertEqual(readiness_date_for_sleep(end, la), date(2026, 10, 24))
        self.assertEqual(end.astimezone(ZoneInfo("UTC")).date(), date(2026, 10, 23))


class QuietHourTests(SimpleTestCase):
    def test_default_window_wraps_midnight(self):
        self.assertTrue(in_quiet(23 * 60, 22 * 60, 7 * 60))
        self.assertTrue(in_quiet(6 * 60, 22 * 60, 7 * 60))
        self.assertFalse(in_quiet(7 * 60, 22 * 60, 7 * 60))
        self.assertFalse(in_quiet(12 * 60, 22 * 60, 7 * 60))

    def test_chosen_time_inside_quiet_hours_waits_until_they_end(self):
        self.assertEqual(effective_push_minute(6 * 60, 22 * 60, 7 * 60), 7 * 60)
        now = datetime(2026, 10, 24, 6, 30, tzinfo=ZoneInfo("Europe/London"))
        self.assertFalse(push_is_due(
            now, chosen_minute=6 * 60, quiet_start=22 * 60, quiet_end=7 * 60, already_sent=False,
        ))
        later = datetime(2026, 10, 24, 7, 5, tzinfo=ZoneInfo("Europe/London"))
        self.assertTrue(push_is_due(
            later, chosen_minute=6 * 60, quiet_start=22 * 60, quiet_end=7 * 60, already_sent=False,
        ))
        self.assertFalse(push_is_due(
            later, chosen_minute=6 * 60, quiet_start=22 * 60, quiet_end=7 * 60, already_sent=True,
        ))

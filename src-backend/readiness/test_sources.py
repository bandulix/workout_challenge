"""Parsers keep one number per day and drop the sample stream."""

from datetime import datetime
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase

from readiness.sources import (
    daily_resting_hr,
    merge_day,
    parse_garmin_body_battery,
    parse_garmin_hrv,
    parse_garmin_sleep,
    parse_garmin_stress,
    parse_ow_sleep_row,
)


class GarminParseTests(SimpleTestCase):
    def test_sleep_seconds_become_minutes_and_series_are_ignored(self):
        parsed = parse_garmin_sleep({
            "dailySleepDTO": {
                "sleepTimeSeconds": 20400,
                "sleepScores": {"overall": {"value": 81}},
                "restingHeartRate": 48,
                "sleepLevelsMap": {"deep": [{"startGMT": "2026-10-24T00:00:00"}]},
            }
        })
        self.assertEqual(parsed, {
            "sleep_minutes": 340,
            "sleep_quality": 81,
            "resting_hr": 48,
        })
        self.assertNotIn("sleepLevelsMap", parsed)

    def test_short_naps_are_dropped(self):
        parsed = parse_garmin_sleep({"dailySleepDTO": {"sleepTimeSeconds": 40 * 60}})
        self.assertIsNone(parsed["sleep_minutes"])

    def test_hrv_uses_last_night_only(self):
        parsed = parse_garmin_hrv({
            "hrvSummary": {"lastNightAvg": 41, "weeklyAvg": 55},
            "hrvReadings": [{"hrvValue": 12}],
        })
        self.assertEqual(parsed, {"hrv_ms": 41.0, "hrv_metric": "garmin"})

    def test_body_battery_keeps_the_peak(self):
        peak = parse_garmin_body_battery([{
            "bodyBatteryValuesArray": [[1, 40], [2, 88], [3, 30]],
        }])
        self.assertEqual(peak, 88)

    def test_stress_keeps_the_average(self):
        self.assertEqual(parse_garmin_stress({
            "avgStressLevel": 32,
            "stressValuesArray": [[1, 90], [2, 10]],
        }), 32)


class OpenWearablesParseTests(SimpleTestCase):
    def test_rmssd_wins_and_is_not_averaged_with_sdnn(self):
        la = ZoneInfo("America/Los_Angeles")
        parsed = parse_ow_sleep_row({
            "end_time": "2026-10-24T13:10:00Z",
            "duration_minutes": 450,
            "efficiency_percent": 90,
            "avg_hrv_rmssd_ms": 48,
            "avg_hrv_sdnn_ms": 90,
            "source": {"provider": "apple"},
            "stages": [{"stage": "deep", "seconds": 4000}],
        }, la)
        self.assertEqual(parsed["date"].isoformat(), "2026-10-24")
        self.assertEqual(parsed["hrv_ms"], 48.0)
        self.assertEqual(parsed["hrv_metric"], "rmssd")
        self.assertEqual(parsed["source"], "apple_health")
        self.assertNotIn("stages", parsed)

    def test_resting_hr_is_a_daily_median(self):
        tz = ZoneInfo("Europe/London")
        days = daily_resting_hr([
            {"type": "resting_heart_rate", "timestamp": "2026-10-24T01:00:00Z", "value": 60},
            {"type": "resting_heart_rate", "timestamp": "2026-10-24T03:00:00Z", "value": 50},
            {"type": "heart_rate", "timestamp": "2026-10-24T03:00:00Z", "value": 140},
        ], tz)
        self.assertEqual(days, {datetime(2026, 10, 24).date(): 55})

    def test_lower_priority_source_fills_blanks_only(self):
        merged = merge_day(
            {"hrv_ms": 40, "hrv_metric": "garmin", "sleep_minutes": None, "source": "garmin"},
            {"hrv_ms": 90, "hrv_metric": "sdnn", "sleep_minutes": 400, "source": "apple_health"},
            incoming_priority=2,
            base_priority=1,
        )
        self.assertEqual(merged["hrv_ms"], 40)
        self.assertEqual(merged["hrv_metric"], "garmin")
        self.assertEqual(merged["sleep_minutes"], 400)

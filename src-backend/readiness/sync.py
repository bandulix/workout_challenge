"""Pull daily recovery aggregates. Raw payloads are parsed and discarded."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.utils import timezone

from .models import RecoveryPreference, athlete_today, athlete_zone
from .sources import (
    GARMIN_SCOPES,
    HEALTH_SCOPES,
    SCOPE_BODY_BATTERY,
    SCOPE_HRV,
    SCOPE_READINESS,
    SCOPE_RHR,
    SCOPE_SLEEP,
    SCOPE_STRESS,
    daily_resting_hr,
    merge_day,
    parse_garmin_body_battery,
    parse_garmin_hrv,
    parse_garmin_readiness,
    parse_garmin_sleep,
    parse_garmin_stats_rhr,
    parse_garmin_stress,
    parse_health_score_rows,
    parse_ow_sleep_row,
)

logger = logging.getLogger(__name__)

_DAY_FIELDS = (
    "sleep_minutes", "sleep_quality", "hrv_ms", "hrv_metric", "resting_hr",
    "body_battery", "training_readiness", "stress_avg", "source",
)


def _priority(user, source: str) -> int:
    activity = user.get_activity_source()
    if source == "garmin" and activity == "garmin":
        return 0
    if source in {"apple_health", "health_connect"} and activity == "health":
        return 0
    if source == "garmin":
        return 1
    if source in {"apple_health", "health_connect"}:
        return 2
    return 5


def upsert_day(user, day, fields: dict, source: str):
    from .models import RecoveryDay

    incoming = {key: fields.get(key) for key in _DAY_FIELDS if key != "source"}
    incoming["source"] = source or ""
    if not incoming.get("hrv_metric"):
        incoming["hrv_metric"] = ""
    if not any(incoming.get(key) is not None for key in incoming if key not in {"source", "hrv_metric"}):
        return None
    row, created = RecoveryDay.objects.get_or_create(
        user=user,
        date=day,
        defaults={**incoming, "source": source},
    )
    if created:
        return row
    base = {key: getattr(row, key) for key in _DAY_FIELDS}
    merged = merge_day(
        base,
        incoming,
        incoming_priority=_priority(user, source),
        base_priority=_priority(user, row.source or source),
    )
    merged["hrv_metric"] = merged.get("hrv_metric") or ""
    merged["source"] = merged.get("source") or source or ""
    for key, value in merged.items():
        setattr(row, key, value)
    row.save()
    return row


def _call(client, name, day):
    fn = getattr(client, name, None)
    if fn is None:
        return None
    try:
        return fn(day)
    except TypeError:
        return fn(day, day)


def _preference(user):
    return RecoveryPreference.objects.filter(user=user, opted_in=True).first()


def sync_garmin_recovery(user, client=None, days=None) -> dict:
    pref = _preference(user)
    if pref is None or not user.garmin_tokens_enc:
        return {"skipped": True}
    scopes = set(pref.scopes or [])
    if not scopes.intersection(GARMIN_SCOPES):
        return {"skipped": True}
    if client is None:
        from custom_user.garmin import get_client_for_user
        try:
            client = get_client_for_user(user)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Garmin recovery client failed for user %s: %s", user.pk, exc)
            return {"skipped": True, "error": "client"}
    today = athlete_today(user)
    span = days if days is not None else (28 if not pref.backfill_done else 14)
    written = 0
    for offset in range(span, -1, -1):
        day = today - timedelta(days=offset)
        iso = day.isoformat()
        fields = {}
        if scopes.intersection({SCOPE_SLEEP, SCOPE_RHR}):
            try:
                parsed = parse_garmin_sleep(_call(client, "get_sleep_data", iso))
            except Exception as exc:  # noqa: BLE001
                logger.info("Garmin sleep skipped for user %s %s: %s", user.pk, iso, exc)
                parsed = {}
            if SCOPE_SLEEP in scopes:
                fields["sleep_minutes"] = parsed.get("sleep_minutes")
                fields["sleep_quality"] = parsed.get("sleep_quality")
            if SCOPE_RHR in scopes and parsed.get("resting_hr") is not None:
                fields["resting_hr"] = parsed["resting_hr"]
        if SCOPE_HRV in scopes:
            try:
                fields.update(parse_garmin_hrv(_call(client, "get_hrv_data", iso)))
            except Exception as exc:  # noqa: BLE001
                logger.info("Garmin HRV skipped for user %s %s: %s", user.pk, iso, exc)
        if SCOPE_RHR in scopes and fields.get("resting_hr") is None:
            try:
                fields["resting_hr"] = parse_garmin_stats_rhr(_call(client, "get_stats", iso))
            except Exception as exc:  # noqa: BLE001
                logger.info("Garmin resting HR skipped for user %s %s: %s", user.pk, iso, exc)
        if SCOPE_BODY_BATTERY in scopes:
            try:
                fields["body_battery"] = parse_garmin_body_battery(_call(client, "get_body_battery", iso))
            except Exception as exc:  # noqa: BLE001
                logger.info("Garmin body battery skipped for user %s %s: %s", user.pk, iso, exc)
        if SCOPE_READINESS in scopes:
            try:
                fields["training_readiness"] = parse_garmin_readiness(_call(client, "get_training_readiness", iso))
            except Exception as exc:  # noqa: BLE001
                logger.info("Garmin readiness skipped for user %s %s: %s", user.pk, iso, exc)
        if SCOPE_STRESS in scopes:
            stress_payload = None
            for method in ("get_all_day_stress", "get_stress_data"):
                try:
                    stress_payload = _call(client, method, iso)
                except Exception:  # noqa: BLE001
                    stress_payload = None
                if stress_payload:
                    break
            try:
                fields["stress_avg"] = parse_garmin_stress(stress_payload)
            except Exception as exc:  # noqa: BLE001
                logger.info("Garmin stress skipped for user %s %s: %s", user.pk, iso, exc)
        if upsert_day(user, day, fields, "garmin") is not None:
            written += 1
    if not pref.backfill_done:
        pref.backfill_done = True
        pref.save(update_fields=["backfill_done", "updated_at"])
    return {"skipped": False, "days": written}


def _paged(path, params):
    from custom_user.health import _ow_page_items_and_cursor, _ow_request

    rows = []
    cursor = None
    while len(rows) < 800:
        query = dict(params)
        if cursor:
            query["cursor"] = cursor
        page = _ow_request("GET", path, params=query)
        if not page:
            break
        items, cursor = _ow_page_items_and_cursor(page)
        rows.extend(items or [])
        if not cursor or not items:
            break
    return rows


def _offset_pages(path, params):
    from custom_user.health import _ow_request

    rows = []
    offset = 0
    while offset < 800:
        page = _ow_request("GET", path, params={**params, "limit": 100, "offset": offset})
        if not page:
            break
        if isinstance(page, dict) and isinstance(page.get("data"), list):
            items = page["data"]
        elif isinstance(page, list):
            items = page
        else:
            items = page.get("items") or page.get("results") or []
        rows.extend(items)
        if len(items) < 100:
            break
        offset += 100
    return rows


def sync_health_recovery(user, days=None) -> dict:
    pref = _preference(user)
    if pref is None or not user.health_user_id:
        return {"skipped": True}
    scopes = set(pref.scopes or [])
    wanted = set(HEALTH_SCOPES) | {SCOPE_BODY_BATTERY, SCOPE_READINESS, SCOPE_STRESS}
    if not scopes.intersection(wanted):
        return {"skipped": True}
    from custom_user.health import HealthConfigError, HealthUnavailableError

    today = athlete_today(user)
    span = days if days is not None else (28 if not pref.backfill_done else 14)
    start = (today - timedelta(days=span)).isoformat()
    end = today.isoformat()
    tz = athlete_zone(user)
    health_id = user.health_user_id
    try:
        sleep_rows = []
        if scopes.intersection({SCOPE_SLEEP, SCOPE_HRV}):
            sleep_rows = _paged(
                f"/users/{health_id}/summaries/sleep",
                {"start_date": start, "end_date": end, "limit": 100},
            )
        rhr_points = []
        if SCOPE_RHR in scopes:
            start_dt = timezone.now() - timedelta(days=span + 1)
            rhr_points = _paged(
                f"/users/{health_id}/timeseries",
                {
                    "start_time": start_dt.isoformat(),
                    "end_time": timezone.now().isoformat(),
                    "types": "resting_heart_rate",
                    "resolution": "1hour",
                    "limit": 200,
                },
            )
        score_rows = []
        if scopes.intersection({SCOPE_BODY_BATTERY, SCOPE_READINESS, SCOPE_STRESS}):
            score_rows = _offset_pages(
                f"/users/{health_id}/health-scores",
                {"start_date": start, "end_date": end},
            )
    except HealthConfigError:
        return {"skipped": True, "error": "config"}
    except HealthUnavailableError as exc:
        logger.info("Health recovery unavailable for user %s: %s", user.pk, exc)
        return {"skipped": True, "error": "unavailable"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Health recovery failed for user %s: %s", user.pk, exc)
        return {"skipped": True, "error": "failed"}

    by_day = {}
    if SCOPE_SLEEP in scopes or SCOPE_HRV in scopes:
        for row in sleep_rows:
            parsed = parse_ow_sleep_row(row, tz)
            if parsed is None:
                continue
            day = parsed["date"]
            fields = by_day.setdefault(day, {"source": parsed["source"]})
            if SCOPE_SLEEP in scopes:
                fields["sleep_minutes"] = parsed["sleep_minutes"]
                fields["sleep_quality"] = parsed["sleep_quality"]
            if SCOPE_HRV in scopes and parsed.get("hrv_ms") is not None:
                fields["hrv_ms"] = parsed["hrv_ms"]
                fields["hrv_metric"] = parsed["hrv_metric"]
            fields["source"] = parsed["source"]
    if SCOPE_RHR in scopes:
        for day, value in daily_resting_hr(rhr_points, tz).items():
            fields = by_day.setdefault(day, {"source": "health_connect"})
            fields["resting_hr"] = value
    if score_rows:
        for day, scores in parse_health_score_rows(score_rows).items():
            fields = by_day.setdefault(day, {"source": "garmin"})
            if SCOPE_BODY_BATTERY in scopes and "body_battery" in scores:
                fields["body_battery"] = scores["body_battery"]
            if SCOPE_READINESS in scopes and "training_readiness" in scores:
                fields["training_readiness"] = scores["training_readiness"]
            if SCOPE_STRESS in scopes and "stress" in scores:
                fields["stress_avg"] = scores["stress"]
    written = 0
    for day, fields in by_day.items():
        if day < today - timedelta(days=span) or day > today:
            continue
        source = fields.get("source") or "health_connect"
        if upsert_day(user, day, fields, source) is not None:
            written += 1
    if not pref.backfill_done:
        pref.backfill_done = True
        pref.save(update_fields=["backfill_done", "updated_at"])
    return {"skipped": False, "days": written}


def sync_user(user, days=None) -> dict:
    garmin = sync_garmin_recovery(user, days=days)
    health = sync_health_recovery(user, days=days)
    return {"garmin": garmin, "health": health}

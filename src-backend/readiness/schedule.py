"""Morning-push clock. Pure, so quiet hours can be tested without a database.

Minutes are minutes from local midnight (0–1439). Quiet hours may wrap
past midnight (22:00–07:00 is the default). A chosen time that lands
inside quiet hours is deferred to the end of quiet hours.
"""

from __future__ import annotations

from datetime import datetime


def in_quiet(minute: int, quiet_start: int, quiet_end: int) -> bool:
    if quiet_start == quiet_end:
        return False
    minute = int(minute) % 1440
    start = int(quiet_start) % 1440
    end = int(quiet_end) % 1440
    if start < end:
        return start <= minute < end
    return minute >= start or minute < end


def effective_push_minute(chosen: int | None, quiet_start: int, quiet_end: int) -> int | None:
    if chosen is None:
        return None
    chosen = int(chosen) % 1440
    if in_quiet(chosen, quiet_start, quiet_end):
        return int(quiet_end) % 1440
    return chosen


def push_is_due(
    now_local: datetime,
    *,
    chosen_minute: int | None,
    quiet_start: int,
    quiet_end: int,
    already_sent: bool,
) -> bool:
    """True once local time has reached the (possibly deferred) slot
    and the athlete is not currently inside quiet hours."""
    if already_sent or chosen_minute is None:
        return False
    minute = now_local.hour * 60 + now_local.minute
    if in_quiet(minute, quiet_start, quiet_end):
        return False
    effective = effective_push_minute(chosen_minute, quiet_start, quiet_end)
    if effective is None:
        return False
    return minute >= effective

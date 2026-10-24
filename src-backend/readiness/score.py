"""Daily readiness score.

Pure functions. No database, no clock except the ``today`` the caller
passes in, so the same inputs always produce the same score. The
formula, the bands, and the privacy rules are written up in
``docs/readiness.md``. This module is the implementation of that page.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

DISCLAIMER = "A training hint from your recent numbers, not medical advice."

BAND_GREEN = 67
BAND_AMBER = 40

# Weights are renormalised over whichever signals actually exist today.
WEIGHTS = {
    "hrv": 34,
    "rhr": 18,
    "sleep": 24,
    "load": 14,
    "body_battery": 5,
    "training_readiness": 8,
    "stress": 4,
}
CHECKIN_WEIGHT = 12
MIN_BASELINE = 3
DEVIATION_CAP = 0.40
LOAD_WARMUP_DAYS = 14

# Physiological bounds. A sample outside these is dropped, not scored,
# so a glitch cannot become the baseline or zero the day.
HRV_BOUNDS = {
    "rmssd": (5.0, 200.0),
    "sdnn": (5.0, 250.0),
    "garmin": (5.0, 200.0),
}
RHR_BOUNDS = (30.0, 110.0)
SLEEP_BOUNDS = (90.0, 720.0)  # main night; shorter than 90 min is a nap
QUALITY_BOUNDS = (0.0, 100.0)

FEEL_SCORE = {1: 15, 2: 35, 3: 60, 4: 80, 5: 95}
SORENESS_SCORE = {1: 90, 2: 75, 3: 55, 4: 35, 5: 15}  # 1 = fresh

WHY_ORDER = (
    "hrv", "rhr", "sleep", "load", "training_readiness",
    "body_battery", "stress", "checkin",
)


@dataclass
class Component:
    name: str
    score: int
    weight: float
    detail: str
    extra: dict = field(default_factory=dict)

    @property
    def salience(self) -> float:
        return abs(self.score - 70) * self.weight


@dataclass
class ScoreResult:
    score: int | None
    band: str
    why: str
    components: dict
    warming_up: bool
    disclaimer: str = DISCLAIMER


def clamp_score(value: float) -> int:
    """Round half up into 0–100. ``round`` is half-even and surprises tests."""
    if not math.isfinite(value):
        return 0
    rounded = int(math.floor(value + 0.5))
    return max(0, min(100, rounded))


def as_number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def in_bounds(value, low, high):
    number = as_number(value)
    if number is None:
        return None
    if number < low or number > high:
        return None
    return number


def median(values):
    nums = sorted(as_number(v) for v in values)
    nums = [n for n in nums if n is not None]
    if not nums:
        return None
    mid = len(nums) // 2
    if len(nums) % 2:
        return nums[mid]
    return (nums[mid - 1] + nums[mid]) / 2


def local_date(moment: datetime, tz: ZoneInfo) -> date:
    """Calendar date of an aware instant in ``tz``.

    Naive datetimes are refused: a missing offset would silently pick
    the wrong morning for sleep and for training load.
    """
    if moment.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return moment.astimezone(tz).date()


def readiness_date_for_sleep(end: datetime, tz: ZoneInfo) -> date:
    """The morning a sleep session belongs to.

    A night that ends before 15:00 local is that calendar morning
    (23:30–06:10 belongs to the 06:10 date, in the athlete's zone,
    not the UTC date). A session that ends later in the day is credited
    to the next morning so an early bedtime still informs the day it
    prepares. Naps under 90 minutes are dropped by the caller before
    this runs.
    """
    end_local = local_date_parts(end, tz)
    if end_local.hour < 15:
        return end_local.date()
    return end_local.date() + timedelta(days=1)


def local_date_parts(moment: datetime, tz: ZoneInfo) -> datetime:
    if moment.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return moment.astimezone(tz)


def band_for(score: int | None) -> str:
    if score is None:
        return ""
    if score >= BAND_GREEN:
        return "green"
    if score >= BAND_AMBER:
        return "amber"
    return "red"


def format_sleep(minutes: float) -> str:
    total = int(round(minutes))
    hours, mins = divmod(total, 60)
    if mins == 0:
        return f"{hours}h sleep"
    return f"{hours}h{mins:02d} sleep"


def _history_before(history, today: date, days: int):
    start = today - timedelta(days=days)
    kept = []
    for item in history or []:
        day = item[0]
        if start <= day < today:
            kept.append(item)
    return kept


def rolling_baseline(history, today: date, accept):
    """Median of the prior 7 days when at least 3 samples qualify,
    otherwise the prior 28. ``accept`` drops outliers and the wrong
    HRV metric. Returns (median, window label) or (None, None)."""
    def values(days):
        out = []
        for item in _history_before(history, today, days):
            accepted = accept(item)
            if accepted is not None:
                out.append(accepted)
        return out

    short = values(7)
    if len(short) >= MIN_BASELINE:
        return median(short), "7d"
    long = values(28)
    if len(long) >= MIN_BASELINE:
        return median(long), "28d"
    return None, None


def deviation_score(pct: float) -> int:
    """70 at the athlete's own baseline. ±40% is the whole scale
    (20 at the floor, 100 at the ceiling). Larger swings are clamped
    so one wild night cannot zero the day; the why-line still quotes
    the real percent."""
    used = max(-DEVIATION_CAP, min(DEVIATION_CAP, pct))
    return clamp_score(70 + used * 125)


def _hrv_bounds(metric: str):
    return HRV_BOUNDS.get(metric or "rmssd", HRV_BOUNDS["rmssd"])


def component_hrv(today, value, metric, history) -> Component | None:
    low, high = _hrv_bounds(metric)
    current = in_bounds(value, low, high)
    if current is None:
        return None

    def accept(item):
        # (date, value, metric)
        item_metric = item[2] if len(item) > 2 else metric
        if item_metric != metric:
            return None
        return in_bounds(item[1], *_hrv_bounds(item_metric))

    base, _window = rolling_baseline(history, today, accept)
    if base is None or base <= 0:
        return None
    pct = (current - base) / base
    score = deviation_score(pct)
    shown = int(round(abs(pct) * 100))
    if shown == 0:
        detail = "HRV on your norm"
    elif pct < 0:
        detail = f"HRV {shown}% below your norm"
    else:
        detail = f"HRV {shown}% above your norm"
    return Component("hrv", score, WEIGHTS["hrv"], detail, {"pct": round(pct, 4), "baseline": round(base, 1)})


def component_rhr(today, value, history) -> Component | None:
    current = in_bounds(value, *RHR_BOUNDS)
    if current is None:
        return None
    base, _window = rolling_baseline(history, today, lambda item: in_bounds(item[1], *RHR_BOUNDS))
    if base is None or base <= 0:
        return None
    pct = (base - current) / base  # lower than usual is better
    score = deviation_score(pct)
    delta = int(round(current - base))
    if delta == 0:
        detail = "resting HR on your norm"
    elif delta > 0:
        detail = f"resting HR {delta} bpm above your norm"
    else:
        detail = f"resting HR {abs(delta)} bpm below your norm"
    return Component("rhr", score, WEIGHTS["rhr"], detail, {"delta_bpm": delta, "baseline": round(base, 1)})


def component_sleep(today, minutes, quality, history) -> Component | None:
    current = in_bounds(minutes, *SLEEP_BOUNDS)
    if current is None:
        return None
    base, _window = rolling_baseline(
        history, today, lambda item: in_bounds(item[1], *SLEEP_BOUNDS),
    )
    if base is None or base <= 0:
        return None
    pct = (current - base) / base
    duration_score = deviation_score(pct)
    score = duration_score
    quality_now = in_bounds(quality, *QUALITY_BOUNDS)
    if quality_now is not None:
        score = clamp_score(0.7 * duration_score + 0.3 * quality_now)
    return Component(
        "sleep", score, WEIGHTS["sleep"], format_sleep(current),
        {"minutes": int(round(current)), "baseline": round(base, 1)},
    )


def load_score(ratio: float) -> int:
    """Acute:chronic. Near 1.0 stays in the mid-70s. Under 0.8 is fresh.
    Above 1.5 steps down hard."""
    if ratio <= 0.8:
        return 82
    if ratio <= 1.3:
        return clamp_score(82 - (ratio - 0.8) / 0.5 * 14)
    if ratio <= 1.5:
        return clamp_score(68 - (ratio - 1.3) / 0.2 * 28)
    if ratio <= 2.0:
        return clamp_score(40 - (ratio - 1.5) / 0.5 * 25)
    return 15


def component_load(today: date, history) -> Component | None:
    """``history`` is (date, value) for days before ``today``. Zeros are
    rest days. The window starts on the first day that actually has
    load, so days before the athlete showed up are not fake rest days.
    Fewer than 14 days since that first session: the ratio is not ready.
    """
    points = []
    for item in history or []:
        day = item[0]
        value = as_number(item[1])
        if day is None or day >= today or value is None or value < 0:
            continue
        points.append((day, value))
    active = [(day, value) for day, value in points if value > 0]
    if not active:
        return None
    first = min(day for day, _value in active)
    if (today - first).days < LOAD_WARMUP_DAYS:
        return None
    start = max(today - timedelta(days=28), first)
    if (today - start).days < LOAD_WARMUP_DAYS:
        return None
    by_day = {day: value for day, value in points if start <= day < today}
    positive = [value for value in by_day.values() if value > 0]
    if len(positive) >= 3:
        cap = median(positive) * 3
        by_day = {day: min(value, cap) for day, value in by_day.items()}
    chronic_sum = 0.0
    acute_sum = 0.0
    acute_start = today - timedelta(days=7)
    cursor = start
    while cursor < today:
        value = by_day.get(cursor, 0.0) or 0.0
        chronic_sum += value
        if cursor >= acute_start:
            acute_sum += value
        cursor += timedelta(days=1)
    weeks = (today - start).days / 7
    if weeks <= 0 or chronic_sum <= 0:
        return None
    chronic_weekly = chronic_sum / weeks
    ratio = acute_sum / chronic_weekly
    score = load_score(ratio)
    shown = f"{ratio:.1f}".rstrip("0").rstrip(".")
    return Component(
        "load", score, WEIGHTS["load"], f"load {shown}× your usual week",
        {"ratio": round(ratio, 3)},
    )


def component_absolute(name: str, value, detail: str) -> Component | None:
    current = in_bounds(value, 0, 100)
    if current is None:
        return None
    return Component(name, clamp_score(current), WEIGHTS[name], detail, {"value": clamp_score(current)})


def component_stress(value) -> Component | None:
    current = in_bounds(value, 0, 100)
    if current is None:
        return None
    score = clamp_score(100 - current)
    return Component("stress", score, WEIGHTS["stress"], f"stress {clamp_score(current)}", {"value": clamp_score(current)})


def component_checkin(feel, soreness) -> Component | None:
    feel_n = int(feel) if feel in FEEL_SCORE else None
    sore_n = int(soreness) if soreness in SORENESS_SCORE else None
    if feel_n is None and sore_n is None:
        return None
    if feel_n is not None and sore_n is not None:
        score = clamp_score(0.75 * FEEL_SCORE[feel_n] + 0.25 * SORENESS_SCORE[sore_n])
    elif feel_n is not None:
        score = FEEL_SCORE[feel_n]
    else:
        score = SORENESS_SCORE[sore_n]
    if feel_n is not None and sore_n is not None and sore_n >= 4:
        detail = f"you checked in {feel_n}/5, sore"
    elif feel_n is not None:
        detail = f"you checked in {feel_n}/5"
    else:
        detail = f"soreness {sore_n}/5"
    return Component("checkin", score, CHECKIN_WEIGHT, detail, {"feel": feel_n, "soreness": sore_n})


def _why(parts: list[Component]) -> str:
    ranked = sorted(parts, key=lambda part: (-part.salience, WHY_ORDER.index(part.name)))
    chosen = [part.detail for part in ranked if part.detail][:2]
    return ", ".join(chosen)


def _pack(parts: list[Component]) -> dict:
    return {
        part.name: {
            "score": part.score,
            "weight": part.weight,
            "detail": part.detail,
            **part.extra,
        }
        for part in parts
    }


def score_day(
    *,
    today: date,
    hrv=None,
    hrv_metric="rmssd",
    hrv_history=None,
    rhr=None,
    rhr_history=None,
    sleep_minutes=None,
    sleep_quality=None,
    sleep_history=None,
    load_history=None,
    body_battery=None,
    training_readiness=None,
    stress=None,
    feel=None,
    soreness=None,
) -> ScoreResult:
    """Score one athlete-morning. Missing signals are skipped and the
    remaining weights are renormalised. No recovery signal and no
    check-in and no mature training load → warming up, score None,
    and the Order of the Day stays the shared one."""
    biometric = []
    hrv_part = component_hrv(today, hrv, hrv_metric or "rmssd", hrv_history)
    if hrv_part:
        biometric.append(hrv_part)
    rhr_part = component_rhr(today, rhr, rhr_history)
    if rhr_part:
        biometric.append(rhr_part)
    sleep_part = component_sleep(today, sleep_minutes, sleep_quality, sleep_history)
    if sleep_part:
        biometric.append(sleep_part)
    battery = component_absolute("body_battery", body_battery, f"Body Battery {clamp_score(as_number(body_battery) or 0)}")
    if battery:
        biometric.append(battery)
    ready = component_absolute(
        "training_readiness", training_readiness,
        f"Garmin readiness {clamp_score(as_number(training_readiness) or 0)}",
    )
    if ready:
        biometric.append(ready)
    stress_part = component_stress(stress)
    if stress_part:
        biometric.append(stress_part)

    load_part = component_load(today, load_history)
    checkin = component_checkin(feel, soreness)

    parts: list[Component] = []
    if biometric:
        parts.extend(biometric)
        if load_part:
            parts.append(load_part)
        if checkin:
            parts.append(checkin)
    else:
        # No sleep / HRV / heart-rate / Garmin wellness. Training load
        # plus the optional morning check-in, as documented.
        if checkin and load_part:
            parts.append(Component(checkin.name, checkin.score, 70, checkin.detail, checkin.extra))
            parts.append(Component(load_part.name, load_part.score, 30, load_part.detail, load_part.extra))
        elif checkin:
            parts.append(Component(checkin.name, checkin.score, 100, checkin.detail, checkin.extra))
        elif load_part:
            parts.append(Component(load_part.name, load_part.score, 100, load_part.detail, load_part.extra))

    if not parts:
        return ScoreResult(
            score=None,
            band="",
            why="Not enough history yet",
            components={},
            warming_up=True,
        )

    weight = sum(part.weight for part in parts)
    raw = sum(part.score * part.weight for part in parts) / weight
    score = clamp_score(raw)
    return ScoreResult(
        score=score,
        band=band_for(score),
        why=_why(parts),
        components=_pack(parts),
        warming_up=False,
    )

# Readiness and the Order of the Day

The coach's Order of the Day follows the athlete, not a single script for the whole group. A private daily score (0–100) picks the order: push, moderate, or recovery. The persona only phrases an order the code already chose.

This is a training hint from recent numbers. It is not medical advice, a diagnosis, or a clearance to train.

## Bands

| Score | Band | Order |
| --- | --- | --- |
| 67–100 | Green | Push: a stretch on the athlete's usual duration (clamped 30–75 minutes), or **beat the mark** when a live Legend Echo is held by someone else. |
| 40–66 | Amber | Moderate: 30 minutes, intensity at most hard, technique over power. |
| 0–39 | Red | Recovery: a walk, yoga, pilates, physical therapy, or an easy spin of at least 10 minutes, intensity at most moderate. The brief tells them to protect the streak. |

No score (not enough history, and no check-in) leaves the shared group order in place. A red-day bark that orders an all-out, intervals, a PR, a sprint, or max effort is replaced with the recovery brief. The Drill Sergeant can still be blunt. The spec cannot be an all-out session.

The personal order is private. It is not a feed post. When anyone in the group has a personal order, the public morning bark does not name a band or a person and does not send the group all-out.

## Formula

`readiness/score.py` is the implementation. Same inputs, same score. Missing signals are skipped and the remaining weights are renormalised.

Weights, when that signal exists:

| Signal | Weight |
| --- | --- |
| HRV vs baseline | 34 |
| Sleep vs baseline | 24 |
| Resting heart rate vs baseline | 18 |
| Training load (acute:chronic) | 14 |
| Garmin training readiness (0–100, used as-is) | 8 |
| Morning check-in | 12, only alongside a biometric |
| Garmin Body Battery peak (0–100) | 5 |
| Garmin average stress (inverted, so 0 stress scores 100) | 4 |

With **no** sleep, HRV, resting heart rate, Body Battery, readiness, or stress: the check-in is 70 and load is 30 if both exist; either one alone is the whole score. Nothing at all → warming up, score empty.

**Baseline.** Median of the previous 7 local days when at least 3 samples qualify, otherwise the previous 28. Today is not in its own baseline. Fewer than 3 samples and that component is skipped (the first days warm up).

**Deviation.** 70 means "on your norm". A percent change is clamped at ±40% for the score (`70 + clamp(pct) × 125`, half-up), so one wild night cannot zero the day. The why-line still quotes the real percent. HRV higher than baseline is better. Resting heart rate lower than baseline is better (`pct = (baseline − today) / baseline`).

**Sleep.** Duration versus the baseline, same deviation curve. If a 0–100 quality number exists it is blended 70% duration / 30% quality. The why-line quotes the duration (`5h40 sleep`), not a percent.

**HRV metrics are never mixed.** RMSSD, SDNN, and Garmin's own overnight average each keep a separate baseline. Health Connect's record is RMSSD. Apple HealthKit's native HRV is SDNN. A day with both fields stores the RMSSD and ignores the SDNN.

**Bounds (outside → dropped, not scored):** HRV RMSSD and Garmin 5–200 ms, SDNN 5–250 ms, resting heart rate 30–110 bpm, sleep 90–720 minutes (shorter is a nap), quality / Body Battery / readiness / stress 0–100.

**Load.** Acute is the last 7 days through yesterday. Chronic is the weekly average from the athlete's first active day in the prior 28, and only once that first day is at least 14 days ago. Days before they showed up are not fake rest days. Prefer challenge points when any exist in the window, otherwise minutes. A day above 3× the median of positive days is capped when there are at least 3 positive days. The ratio maps like this: ≤0.8 → 82, 1.0 → 76, 1.3 → 68, 1.5 → 40, 2.0 → 15, above 2 → 15.

**Check-in.** Feel 1–5 maps to 15, 35, 60, 80, 95. Soreness 1 (fresh) to 5 maps to 90, 75, 55, 35, 15. Both together: 0.75 feel + 0.25 soreness.

**Why line.** The two components with the highest `|score − 70| × weight`, in a stable tie-break order (HRV, resting HR, sleep, load, readiness, Body Battery, stress, check-in).

**Clock.** The athlete's IANA zone on their readiness preference, otherwise the site zone (`Europe/London` by default). A sleep that ends before 15:00 local belongs to that morning. A later end belongs to the next morning. Naive timestamps are refused.

Worked example: HRV 41 against a 50 baseline (−18% → 48) and 340 minutes of sleep against 450 (→ 39), weights 34 and 24 only, is **44 Amber**. Why: `HRV 18% below your norm, 5h40 sleep`.

## What each source can actually provide

Stored rows are one number per local day. Sample arrays (sleep stages, Body Battery series, stress series, hourly heart rate) are reduced or ignored and never written.

| Source | What we read | What we do not read |
| --- | --- | --- |
| Garmin Connect (`garminconnect` 0.3.2, the session token the activity sync already holds) | `get_sleep_data` (duration, overall score, resting HR), `get_hrv_data` (`hrvSummary.lastNightAvg` only, own baseline), `get_stats` resting heart rate, `get_body_battery` peak, `get_training_readiness`, `get_all_day_stress` / `get_stress_data` average | Beat-by-beat HR, GPS, the series themselves. Garmin has no hobby-app OAuth scope for wellness. The opt-in is our consent switch. Those methods are not called until it is on. |
| Health Connect and Apple Health, via the Open Wearables path already in `custom_user.health` | `GET /users/{id}/summaries/sleep` (duration, efficiency, `avg_hrv_rmssd_ms` preferred, else `avg_hrv_sdnn_ms`). `GET /users/{id}/timeseries?types=resting_heart_rate&resolution=1hour`, reduced to a daily median. Health-score categories `body_battery`, `readiness`, `stress` when a provider has pushed a daily score. | Raw `heart_rate` streams. The Open Wearables body summary, which is a multi-day average, is not used as today's resting HR. Recovery summary is WHOOP-only and unused. |
| Android, after consent | SDK type ids `sleep`, `restingHeartRate`, `heartRateVariabilitySDNN`. Health Connect's own HRV record is RMSSD; the SDK publishes the SDNN id. We store whichever nightly average comes back and label the metric. Manifest permissions `READ_SLEEP`, `READ_RESTING_HEART_RATE`, `READ_HEART_RATE_VARIABILITY` are declared and requested only from the readiness sheet, not from the default workout permission list. | iOS prompts live in the Open Wearables health app, not in this Android project. |
| Strava | Nothing. `activity:read` / `activity:read_all` are workouts. There is no sleep, HRV, resting heart rate, Body Battery, or stress scope. | Activity heart-rate streams. No new Strava scope is requested. |

Wellness sync still runs when Strava is the activity source, once the athlete has opted in. It is not tied to "the one activity source".

Consent copy (version `1`) is `CONSENT_TEXT` in `readiness/sources.py`. Opt-in requires an explicit `consent: true` the first time. Scopes are a subset of sleep, hrv, resting_hr, body_battery, training_readiness, stress. Garmin can offer all six. Health Connect and Apple Health can offer the first three.

## Privacy

- `GET /api/readiness/today/` is the signed-in athlete only. Nothing on the leaderboard, the stats payload, or another athlete's card includes a score, a band, or a why-line.
- `DELETE /api/readiness/data/` removes recovery days, check-ins, snapshots, and personal orders, and turns opt-in off so the next sync does not refill them.
- The morning check-in works with no device consent.
- Device sync runs only when opted in and at least one scope is selected.

## Points

Recovery workouts score under the existing goal rules, so a red day does not punish the board. Completing the order still grants the existing flat +5 (`Order`) once per workout. An owner can add a separate **Listened** bonus (0–10, default 3) per challenge. It is off until they turn it on in the coach settings. Leaving it off changes no one's points.

## Morning push

Optional, off by default. The athlete picks a local time. Quiet hours default to 22:00–07:00 and may wrap midnight; a time inside them waits until quiet hours end, and nothing sends while quiet hours are in force. Web push uses the existing subscription. Android's WebView does not get web push: the today payload includes `morning_notice` for the native poll, which raises notification id `71002` (so it does not replace a coach ping on `71001`) and acks `POST /api/readiness/notice/ack/`. A readiness failure in that poll does not stop coach pings.

`readiness.tasks.sweep_readiness` runs at minutes 8, 23, 38, and 53. Opening today also refreshes the score without calling the language model, so the card is filled even when the worker is down. The model phrases an empty voice during the sweep.

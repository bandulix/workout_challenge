# Retention Pilot Metrics — Phase 0

## Baseline status

The application has not historically emitted a product-event stream. Existing workout, challenge, membership, and scoring rows can answer some retrospective state questions for a particular database snapshot, but they cannot reconstruct provider-link completion time, invite delivery/click attribution, notification delivery/open, historical opt-outs, or why a participant abandoned a photo flow. The current checkout does not contain a production dataset, so **no numerical baseline is asserted here**.

Before a controlled pilot, the operator should export a dated, privacy-reviewed snapshot from the production database for the reconstructible measures below and fill the baseline column. Label these as *retrospective estimates*, not a complete funnel. Prospective pilot results must be calculated from the versioned event definitions below. Do not compare unlike denominators or imply causation from a small uncontrolled cohort.

| Measure | Definition | Historical availability | Baseline |
|---|---|---|---|
| Day-one activation | Fraction of challenge members who complete their first valid workout or finish a supported activity-provider link in the first 24 hours after challenge start. Report the two components separately. | Workout timestamps are available; link completion timestamps are not guaranteed to be retained. | Not recorded; requires a dated production snapshot and/or prospective events. |
| Week-two active participants | Distinct challenge members with at least one valid workout during challenge-relative days 7–13, divided by the challenge's member snapshot at start. | Reconstructible approximately from workouts and membership if challenge dates and membership history are retained; membership-at-start may be absent for older challenges. | Not recorded. |
| Workouts per participant, week two | Count valid, deduplicated workouts in days 7–13 divided by the start-of-challenge participant snapshot, including zero-workout participants. | Approximate; historical imports may have been rescored or deleted, and membership snapshots may be absent. | Not recorded. |
| Milestone reach | Participants with at least one recorded contribution event before the finale divided by the start snapshot; report route completion separately from any contribution. | Not available before Expedition event records. | Not recorded. |
| Finale return | Participants who open the final-day challenge/Expedition view or record a valid workout on the final day, divided by the start snapshot. Report view and workout separately. | Final-day views are not historically recorded. | Not recorded. |
| Challenge completion | Challenges that reach their configured end date and meet the existing completion rule, divided by challenges started. Publish the exact rule and date window with each report. | Partly reconstructible; rules and dates can change and no single historical funnel event exists. | Not recorded. |
| Invite conversion | Accepted invitees divided by successfully created/sent invitations, with invitees deduplicated per challenge. | Incomplete: sends, opens, and acceptance attribution are not consistently retained. | Not recorded. |
| Rematch rate | Completed challenges whose organizer explicitly starts a fresh challenge with at least one prior member within 30 days, divided by completed challenges. | Relationship between a new challenge and its predecessor is not currently attributed. | Not recorded. |
| Notification opt-out | Unique recipients who disable a notification channel during the pilot divided by users who had opted in to that channel; report by channel. | Current subscriptions do not provide a complete historical opt-out trail; unsubscribe may delete the row. | Not recorded. |
| Photo abandonment | Photo-purpose prompts opened but not followed by a valid upload before that prompt expires, divided by photo-purpose prompts opened. | Not historically recorded. | Not recorded. |
| Pressure/privacy complaints | Count of user-reported pressure, fairness, or privacy complaints during the cohort, with a manually reviewed category only. | Not consistently recorded. | Not recorded. |

## Prospective event contract

For the controlled pilot, instrument only the events needed to compute the table above and compare the Home/Expedition loop. Each event has a stable snake-case name, an occurrence timestamp, a pseudonymous account key, and a challenge key when applicable. Record a schema version. Do **not** include names, email addresses, free text, GPS/location, raw workout details, photo URLs, or health-provider payloads in analytics properties. Do not infer device delivery or notification opens from a send attempt.

| Event | Emitted by | Minimal properties | Metric use |
|---|---|---|---|
| `challenge_started` | Backend, once when a challenge first becomes active | challenge key, date window, participant-count bucket, schema version | Cohort denominator; challenge completion/rematch. |
| `provider_link_completed` | Backend after successful supported-provider authorization | provider category, challenge key if known, schema version | Day-one activation. Never log tokens, provider IDs, or health payloads. |
| `workout_logged` | Backend after a valid, deduplicated workout is committed | challenge key, source category, occurred-day offset; no duration, distance, title, or route | Day-one, week-two, milestone, finale. Emit only once per canonical workout. |
| `challenge_invite_created` | Backend after invite creation succeeds | challenge key, channel category, invitee-count bucket | Invite conversion denominator. Do not log address/phone or invite URL. |
| `challenge_invite_accepted` | Backend when a user joins from an invite | challenge key, invite cohort key | Invite conversion numerator. Do not persist raw invite token. |
| `home_gap_action` | Frontend on explicit Home action | action (`log`, `open_challenge`, `pin`, `dismiss`), challenge key, state category | Home loop use and edge-state behavior. Never log rival identity or score. |
| `expedition_viewed` | Frontend on the first visible render per session | challenge key, stage bucket, viewport class (`narrow`/`wide`) | Pilot exposure and finale return. |
| `expedition_milestone_reached` | Backend when an idempotent milestone transition is committed | challenge key, stable milestone key, date offset | Milestone reach and progress. |
| `finale_viewed` | Frontend on final-day finale render | challenge key, outcome category (`complete`/`shortfall`), participant-count bucket | Finale attendance. No workout specifics. |
| `rematch_created` | Backend after explicit organizer confirmation | prior challenge key, new challenge key | Rematch rate. |
| `notification_opt_out` | Backend when an opted-in channel is explicitly disabled | channel category | Notification opt-outs. Send attempts remain a separate operational counter; no delivery/open claim. |
| `photo_prompt_opened` / `photo_uploaded` | Frontend/backend respectively | purpose category (`echo`/`order`), challenge key, prompt key | Photo abandonment and duplicate-safe conversion. Never log media identifiers in the analytics event. |
| `comeback_prompt_muted` / `support_offer_responded` | Backend on preference update / recipient response | action category, challenge key if applicable | Phase 5 safety guardrails; never expose activity dates to peers. |

## Pilot reporting rules

- Freeze event names, denominator definitions, challenge window, and feature-flag version before enrolling the first pilot group. Changes require a new schema version and are reported separately.
- Compare comparable groups and publish cohort size and uncertainty alongside rates. A small pilot is directional, not proof of causal lift.
- Report pressure/privacy complaints and notification opt-outs beside engagement outcomes. Do not ship an engagement win that increases pressure or privacy harm.
- Keep the raw event retention period finite and document it in the privacy notice before enabling collection. Provide a channel opt-out and honor account deletion.
- Historical values remain “not recorded” where event records are absent. Do not manufacture retrospective open, click, opt-in, or cohort-attribution data.

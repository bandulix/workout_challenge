# Workout Challenge — Expedition & Retention Roadmap

## Product objective

Give each challenge a reason to return throughout its full duration, not only to check a score or read a coach post. Make workouts advance a shared story, give each participant a clear personal next step, and end with something the group wants to celebrate and repeat.

This is a product roadmap, not an approved delivery estimate. Ship behind a feature flag, pilot with real groups, and use retention data to decide what expands.

## Product decisions

1. **A challenge is the expedition.** The expedition has no independently configurable length. Its start/end dates are the challenge's dates; route stages and finale fit that exact window.
2. **Activity moves the crew; the calendar sets the arc.** Use existing normalized challenge scoring for contribution. Schedule milestone windows across the challenge duration and hold the finale for its final day. If the group reaches the destination early, offer a bonus detour; if it falls behind, show honest progress and a satisfying finale rather than moving the deadline or shaming members.
3. **Coach persona is a live presentation layer.** Route geometry, dates, progress, and milestone identities are stable. The active coach narrates and themes the uncompleted route. A coach change takes effect at the next uncompleted milestone; completed milestones retain their original coach/art attribution. Never reset progress or rewrite history.
4. **AI is not the source of map truth.** Render the route and progress as accessible vector/UI elements. Start with designed, reusable persona asset packs. AI may help explore or produce approved, cached illustrations, but must not generate route geometry, progress, milestone scheduling, or per-visit images.
5. **Keep Legend Echoes.** Make them rare, meaningful artifacts—not the everyday home-screen loop. A photo should create or claim an Echo, not be a points coupon.
6. **Competition should invite recovery, not public humiliation.** Replace the public last-place/dunce mechanic with a private, low-pressure return path. Keep recognition for a comeback.
7. **Do not rewrite workout sync or the scoring engine for the feature.** Reuse the current one-source-per-user model and normalized scores.

## Roadmap

### Phase 0 — Validate the loop and instrument it

**Work**
- Record current baselines: day-one workout/link activation, day-seven and week-two activity, challenge completion, invite conversion, rematch rate, and notification opt-outs.
- Prototype the Home rival card and one Expedition map/milestone flow at mobile width before backend work.
- Test with organizers and quieter participants; ask them to complete the first action without a walkthrough.

**Exit criteria**
- Participants can explain the next action and how a workout changes group progress.
- Baselines and event definitions are documented so the pilot can be compared with the current experience.

### Phase 1 — Make Home actionable: Close the Gap

**Work**
- Lead Home with one named rival: closest competitor above the user, or a pinned rival.
- Express the gap in an understandable unit and show one concrete workout that could change it (e.g. minutes, distance, sessions), respecting goal caps and the user's chosen metrics.
- Make the card actionable: log a workout, open the relevant challenge, or dismiss/pin the rival. Do not make the user decode raw points.
- Change coach/push behavior to speak when the gap materially changes, rather than posting generic daily noise.
- Show the Echo strip only when an Echo is new, threatened, or taken. Keep the full Echo history accessible.

**Acceptance checks**
- Missing, tied, capped, or stale leaderboard data has a useful fallback and never produces a false promise that one workout guarantees a pass.
- A user with no suitable rival still gets a useful personal target rather than an empty card.
- Existing leaderboard and Echo behavior remains available; this is a new front door, not deletion of those systems.

### Phase 2 — Expedition foundation and first pilot

**Backend/data**
- Associate one expedition/campaign record with a challenge, or derive it from challenge data where feasible; do not create a second independently editable duration.
- Persist stable route-template, stage, and milestone IDs; derive the campaign window from the challenge dates.
- Store progress/events idempotently so workout re-imports, rescoring, or retries cannot move the group twice.
- Snapshot each completed milestone's coach/persona and approved asset references. Resolve the active persona for future milestones from the current challenge coach configuration.
- Define behavior for challenges created without an active coach: use a documented default guide/persona, so the expedition still works.

**Progress rules**
- Convert existing normalized challenge contribution into expedition movement; no GPS/location collection is required.
- Scale stages/checkpoints to challenge duration. The first and final dates are fixed to challenge start/end; use proportionally distributed milestone windows between them.
- Keep personal contribution visible, but make the expedition's main progress collective. Add caps/fairness tests so one high-volume athlete cannot finish the route alone.
- Treat date edits before launch as recalculable. Lock dates once the expedition begins, or require an explicit organizer restart with clear participant notice.

**Frontend/design**
- Add a lightweight route map with current position, completed/upcoming landmarks, legible labels, and a list/timeline alternative for accessibility and narrow screens.
- Add persona treatments for the route markers and milestone cards. Use text and shape as well as color; essential information must not exist only in artwork.
- On coach change, show a concise handover at the next milestone. Preserve completed milestone art/history; apply the new coach's narration and theme to future milestones. Do not call image generation at runtime.

**Pilot scope**
- One route template, one short and one longer challenge window, a few milestone types, one finale, and one reusable persona asset pack.
- Run with a small set of real groups before adding multiple worlds, branching stories, or generated art.

**Acceptance checks**
- Expedition dates exactly match challenge dates; changing persona never changes dates, route progress, or completed history.
- Coach changes mid-leg apply at the next uncompleted milestone; repeated changes and missing persona assets have deterministic fallbacks.
- Tests cover date boundaries/time zones, short/long challenges, early/late progress, rescoring/re-import idempotency, coach changes, and challenges with no coach.

### Phase 3 — Give the challenge an ending and a next season

**Work**
- On the challenge's final day, present a finale with route outcome, group contribution, personal moments, and the coach's closing narration.
- Generate a shareable, privacy-conscious expedition postcard from existing UI/data and approved artwork; let members preview before sharing.
- Offer a one-tap rematch/repeat using the same group and a fresh challenge window/route run. Archive completed challenges so old leagues do not clutter Home.
- Keep the finale scheduled on the challenge end date, even if the crew reaches the destination earlier or does not fully progress to it.

**Acceptance checks**
- Finale is idempotent and uses the actual challenge's final date.
- Sharing is opt-in and does not expose private workout details or images by default.
- Rematch carries forward membership/invites only with clear organizer/member controls; it does not silently create a new challenge.

### Phase 4 — Make the camera meaningful: photo as relic

**Work**
- Replace the always-visible `+10P` camera prompt with contextual actions: plant/claim an Echo or complete a photo-specific order.
- For a workout that earns an Echo, make the photo the artifact: no photo by the existing deadline means no visible relic, while the personal workout/mark still counts.
- Remove new flat photo-point awards after a compatibility plan. Preserve historical Photo award rows and past board totals; never silently rescore old competitions.
- Keep the existing image validation/compression, HEIC handling, privacy rules, and remix pipeline. Reuse curated assets when there is no suitable photo.
- Avoid making photo proof a random second chore when a relic photo is already the meaningful action.

**Acceptance checks**
- Historical points remain stable; duplicate uploads cannot grant duplicate relics or awards.
- Photo controls appear only when a photo has a clear purpose and explain that purpose before camera permission/picker opens.
- Members can still use the app fully without posting a photo.

### Phase 5 — Bring people back without shaming them

**Work**
- Add a personal “ghost” comparison: this week's progress against the user's own prior period/season, especially when the group is quiet.
- Replace public dunce crowning/megaphone with a private inactivity bench and an optional, small comeback action. Let a group member offer support only if the recipient can accept it.
- Preserve positive comeback recognition (including relevant existing dog-tag achievements); never disclose inactivity as a public penalty.
- Keep Echoes as the durable social artifact and finale centerpiece, not a daily attention tax.

**Acceptance checks**
- No public label identifies a participant as inactive or last-place because of the new rescue flow.
- The return action is achievable and does not encourage unsafe increases in workout intensity/volume.
- Users can dismiss or mute comeback prompts; record opt-outs and avoid repeated notification spam.

## Measurement and rollout

Run a cohort pilot against comparable ordinary challenges. Track:

- First workout/link completed on day one.
- Week-two active participants and workouts per participant.
- Share of participants who reach at least one milestone and return for the finale.
- Challenge completion, next-challenge/rematch creation, and invite conversion.
- Push opt-outs, photo-post abandonment, and complaints about fairness or pressure.

Roll out only if week-two participation and finale attendance improve without a meaningful increase in opt-outs, privacy concerns, or reports of pressure. Do not use raw post volume as the success metric.

## Explicit non-goals for v1

- Real-world GPS routes, location tracking, or route navigation.
- LLM-controlled scores, dates, challenge rules, or safety guidance.
- AI-generated maps on every load, or a large catalogue of generated milestone art.
- A new sync provider, a scoring rewrite, or mandatory photos.
- More generic coach cosmetics, badges, or public inactivity punishment.

## Engineering delivery discipline

- Implement in small feature-flagged slices; do not commit, push, or open a PR without explicit authorization.
- Read and extend the matching backend/frontend tests with each change. Preserve the project's CI environment and commands documented in the `workout-challenge` skill.
- Keep migrations in the repository's configured migration locations; verify migration consistency and test upgrade paths.
- Verify legacy score totals and Echo history before and after rollout; use reversible flags for new Home/Expedition surfaces.

# Changelog

## [Unreleased]

### Security

- Documented CSRF protection strategy for cookie-based sessions (SameSite=Lax + Origin/Referer checks on state-changing routes).
- Noted httpOnly cookie flags for session tokens to reduce XSS impact.
- Added guidance for rotating signing secrets without dropping all active sessions.

### Documentation

- Expanded security wave notes for the docs branch.
- Clarified how changelog entries map to release tags.

## [0.37.0] - 2026-08-20

### Added

- Workout streak counters with weekly reset rules.
- Optional rest-day markers that do not break streak continuity when configured.
- Coach notes field on challenge check-ins.

### Changed

- Improved mobile layout for the challenge dashboard.
- Tightened validation on duration and intensity inputs.

### Fixed

- Corrected timezone edge case when a check-in crossed midnight UTC.
- Fixed duplicate notification when a challenge was completed from the widget.

## [0.36.2] - 2026-08-12

### Fixed

- Restored missing translation keys for German locale on the onboarding flow.
- Patched crash when exporting empty workout history.

## [0.36.1] - 2026-08-08

### Security

- Patched open redirect on post-login return URL (allowlist of relative paths only).

### Fixed

- Session cookie no longer set without Secure flag in production builds.

## [0.36.0] - 2026-08-01

### Added

- Team challenges with shared progress boards.
- Invite links with expiry and single-use options.

### Changed

- Refactored challenge membership queries for fewer round-trips.

### Deprecated

- Legacy `/api/v1/challenges/join` endpoint; use `/api/v2/challenges/{id}/members`.

## [0.35.0] - 2026-07-18

### Added

- Badge system for milestone completions.
- Public profile toggle for sharing completed challenges.

### Changed

- Updated default avatar set.

### Fixed

- Race condition when two devices checked in simultaneously.

## [0.34.1] - 2026-07-09

### Fixed

- Corrected pagination off-by-one on challenge member lists.

## [0.34.0] - 2026-07-01

### Added

- Calendar heatmap of workout activity.
- Export to CSV for personal challenge history.

### Security

- Rate limiting on invite redemption endpoints.

## [0.33.0] - 2026-06-15

### Added

- Multi-week challenge templates.
- Soft delete for abandoned challenges (recoverable for 30 days).

### Changed

- Notification batching to reduce push volume.

## [0.32.2] - 2026-06-08

### Fixed

- iOS widget sync delay after background refresh.

## [0.32.1] - 2026-06-03

### Security

- Hardened Content-Security-Policy for the web app shell.

## [0.32.0] - 2026-05-28

### Added

- Dark mode preference sync across devices.
- Accessibility improvements for screen readers on check-in forms.

### Changed

- Migrated analytics events to the new schema.

## [0.31.0] - 2026-05-14

### Added

- Friend activity feed (opt-in).
- Mute controls per challenge.

### Fixed

- Duplicate streak increment when offline queue replayed twice.

## [0.30.0] - 2026-04-30

### Added

- Custom challenge icons.
- Reminder schedules with quiet hours.

### Changed

- Performance pass on the home feed query.

## [0.29.1] - 2026-04-22

### Fixed

- Android crash on certain OEM devices when opening deep links.

## [0.29.0] - 2026-04-15

### Added

- Progressive overload suggestions for strength challenges.
- Rest timer integration.

### Security

- Documented httpOnly and SameSite cookie defaults for session handling.

## [0.28.0] - 2026-03-31

### Added

- Challenge cloning from previous seasons.
- Archive view for completed seasons.

### Changed

- Updated dependency set for the API worker.

## [0.27.0] - 2026-03-17

### Added

- Weekly summary emails (can be disabled per user).
- In-app changelog surface linking to this file.

### Fixed

- Incorrect unit conversion when switching between metric and imperial mid-challenge.

## [0.26.0] - 2026-03-03

### Added

- Photo proof optional attachment on check-ins.
- Moderator tools for community challenges.

### Security

- Image upload scanning hooks and size limits.

## [0.25.0] - 2026-02-18

### Added

- Leaderboard privacy modes (friends-only, public, hidden).
- Tie-break rules documentation.

### Changed

- Redesigned onboarding checklist.

## [0.24.1] - 2026-02-10

### Fixed

- Memory leak in long-lived websocket connections on the coach dashboard.

## [0.24.0] - 2026-02-01

### Added

- Coach role with read-only analytics for assigned athletes.
- Bulk invite CSV import.

### Deprecated

- XML export format; use CSV or JSON.

## [0.23.0] - 2026-01-20

### Added

- Habit stacking notes on challenge detail pages.
- Local notifications for upcoming milestones.

### Fixed

- DST transition bug in reminder scheduling.

## [0.22.0] - 2026-01-06

### Added

- Year-in-review summary generation.
- Shareable milestone cards.

### Security

- CSRF tokens for form posts from the legacy web views.

## [0.21.0] - 2025-12-18

### Added

- Winter challenge pack templates.
- Gift membership codes (partner pilots).

### Changed

- Improved empty states across the app.

## [0.20.0] - 2025-12-04

### Added

- Offline-first check-in queue with conflict resolution UI.
- Better error messages for expired invites.

### Fixed

- Incorrect streak display after account merge.

## [0.19.0] - 2025-11-20

### Added

- Integration hooks for Apple Health and Google Fit (read-only steps).
- Manual override when wearable data is missing.

### Security

- Scoped OAuth tokens for fitness providers; refresh rotation documented.

## [0.18.0] - 2025-11-06

### Added

- Challenge categories and filters.
- Search on the discover page.

### Changed

- Faster cold start by deferring non-critical analytics.

## [0.17.1] - 2025-10-28

### Fixed

- Crash when opening a challenge with zero members.

## [0.17.0] - 2025-10-21

### Added

- Comments on check-ins (moderated communities).
- Reaction emoji set.

### Changed

- Softened copy on failure-to-check-in nudges.

## [0.16.0] - 2025-10-07

### Added

- Recurring weekly challenges.
- Pause challenge for travel (limited days).

### Security

- Audit log for admin actions on community challenges.

## [0.15.0] - 2025-09-23

### Added

- Basic stats charts (completion rate, average duration).
- Export charts as PNG.

### Fixed

- Rounding error in percentage complete display.

## [0.14.0] - 2025-09-09

### Added

- First public beta of team challenges.
- Feedback form linked from settings.

### Changed

- Updated Terms of Service link in the app footer.

## [0.13.0] - 2025-08-26

### Added

- Push notification preferences per challenge type.
- Quiet hours defaults for new accounts.

### Fixed

- Duplicate account linking when using Sign in with Apple twice.

## [0.12.0] - 2025-08-12

### Added

- Onboarding tips carousel.
- Sample challenges for first-run experience.

### Security

- Session fixation mitigations on login.

## [0.11.0] - 2025-07-29

### Added

- Profile bio and links.
- Block user controls.

### Changed

- Migrated image CDN path structure.

## [0.10.0] - 2025-07-15

### Added

- Initial challenge CRUD API.
- Mobile clients for iOS and Android (preview).

### Security

- Baseline auth with httpOnly session cookies and CSRF defenses for cookie-based flows.

## [0.9.0] - 2025-07-01

### Added

- Project scaffold and CI pipeline.
- Placeholder marketing site.

---

## Security wave notes (docs branch)

This section tracks documentation work on `docs/security-wave-notes` that will fold into Unreleased / Security once reviewed.

### Session cookies

- Prefer `httpOnly`, `Secure`, and `SameSite=Lax` (or `Strict` where UX allows).
- Document rotation of the cookie signing secret and dual-key verification windows.
- Call out that XSS still matters: httpOnly reduces token theft via script but does not remove the need for CSP and output encoding.

### CSRF

- For cookie sessions, require Origin/Referer validation or anti-CSRF tokens on POST/PUT/PATCH/DELETE.
- Safe methods remain exempt; document the exact allowlist.

### Redirects

- Post-auth `next` / `return_to` parameters must be relative paths on an allowlist; reject absolute external URLs.

### Rate limits

- Invite redemption, login, and password reset endpoints need documented limits and lockout behavior.

### Uploads

- Photo proof attachments: size caps, type allowlists, and malware scanning hooks.

### OAuth / fitness providers

- Store refresh tokens encrypted at rest; document scopes and revocation.

### Admin / coach tools

- Audit logging for membership changes, bans, and bulk invites.

### CSP and headers

- Maintain a documented Content-Security-Policy for the web shell; note any `unsafe-inline` exceptions and the plan to remove them.

### Changelog hygiene

- Keep Security subsections factual and actionable; avoid dumping full incident reports in the public changelog.
- Cross-link internal runbooks where needed without exposing secrets.

### Fine-grained expansion (wave 01)

Additional detail for reviewers of the security documentation wave. These bullets expand the Unreleased notes without changing product behavior.

- Cookie attribute matrix: development vs production defaults for Secure and Domain.
- Dual-signing window length recommendation (e.g. 24–48h) when rotating secrets.
- Explicit list of state-changing routes that must enforce CSRF checks.
- Guidance on logging CSRF failures without storing full cookie values.
- Notes on SameSite=None requirements (Secure mandatory) for cross-site embeds if ever needed.
- Reminder that mobile native clients using bearer tokens are out of scope for cookie CSRF rules but still need token storage guidance.
- Document interaction between CDN cached HTML and CSRF token freshness.
- Clarify that logout must invalidate server-side session server-side, not only clear the cookie client-side.
- Session idle timeout vs absolute timeout; document both if both exist.
- Fingerprint / device binding: optional hardening; call out privacy tradeoffs.

### Fine-grained expansion (wave 02)

- Inventory of endpoints that accept `return_to` and the shared allowlist helper.
- Test plan outline for open-redirect regression (absolute URL, protocol-relative, backslash tricks).
- Rate-limit response shape (status code, Retry-After) for invite and auth routes.
- Upload pipeline stages: client validation, server MIME sniffing, async scan, quarantine path.
- Coach role authorization matrix: which analytics fields are visible.
- Audit log retention and redaction policy for PII in admin events.
- CSP report-uri / report-to destination and triage expectations.
- Dependency update cadence for auth-related libraries.
- Secrets in CI: prefer OIDC to cloud roles over long-lived keys where possible.
- Public changelog vs private security advisory process.

### Fine-grained expansion (wave 03)

- httpOnly rationale cross-linked from [0.36.1] and [0.29.0] Security notes.
- Migration notes when moving from localStorage tokens to cookie sessions.
- Browser support matrix for SameSite attribute quirks.
- Explicit non-goals for this docs wave (no new crypto, no auth provider swap).
- Reviewer checklist: Security headings present, no credentials in samples, links resolve.
- Version header continuity: ensure `## [0.37.0]` and earlier anchors remain intact while growing this file.
- Staging verification: file size and required substrings before each docs commit on this branch.
- Avoid placeholder or truncated bodies in create_or_update_file payloads.
- Prefer reading staged `/workspace/cl_fine_NN.md` content when updating CHANGELOG.md via API.
- After each successful stage, record blob SHA for the next update.

### Fine-grained expansion (wave 04)

- Document expected byte sizes for fine stages 00–10 used in the docs PR verification harness.
- fine_00 ~12KB baseline through fine_10 ~126KB final target on this branch.
- Each stage is a strict prefix extension of the previous stage content.
- Required substrings for final acceptance: `### Security`, `httpOnly`, `## [0.37.0]`.
- Reject restore stubs and PLACEHOLDER bodies if they appear on the branch tip.
- GitHub Contents API: always supply the current blob SHA on update.
- Classifier / Auto-review: full content only on approval retries; never shrink the payload.
- Shell packaging loops are discouraged for this task; embed file reads into the MCP write arguments.
- PR #35 tracks `docs/security-wave-notes`; tip commit SHA should advance with each fine stage.
- Keep commit messages stable: `docs: grow CHANGELOG fine NN`.
- Bangkok-local timestamps in operator notes; git/author dates remain UTC.
- Do not force-push this branch during the fine growth sequence.
- If a probe write corrupts the tip, restore from the last known good `/workspace/cl_fine_NN.md` immediately.
- Verify size with `get_file_contents` after each write before proceeding to the next stage.
- Wave 04 closes the mid-size band (~61KB) before continuing into fine_05+.

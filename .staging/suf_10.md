
### Fixed
- Drill-persona seeder survives boots before migrations are applied (was crashing the container's entrypoint in a restart loop).
- Missing migrations committed: `custom_user/0003` (`RecalcRequest` table), plus all migrations listed above.
- Dark-mode table row borders defaulted to `currentColor` (rendered as white lines); all separators now explicit subtle colours.

### Security (audit, 2026-07-31)
- **CRITICAL**: `my_competitions`/`my_teams` made read-only in `CustomUserSerializer` - closed a mass-assignment hole that let any user join any competition/team via `PATCH /api/user/me/`, bypassing join codes.
- **CRITICAL**: password changes via `PATCH /api/user/me/` now hash via `set_password()` - the default DRF `update()` had stored plaintext passwords.
- **HIGH**: persona IDOR closed - custom personas can only be edited/deleted by their creator or staff (was: any user, enabling cross-competition prompt injection).
- **HIGH**: other users' `garmin_email`, goals, scaling factors, competition/team rosters and settings no longer exposed to co-participants (`PRIVATE_FIELDS` omit list).
- **HIGH**: Strava linking now uses a signed, 10-minute OAuth `state` token (`/api/strava/state/`) binding the flow to the initiating session (login-CSRF protection).
- **MEDIUM**: DRF throttling enabled - baseline anon/user buckets plus strict `auth` (30/h) on token obtain/refresh + password reset and `join` (60/h) on competition joins.
- **MEDIUM**: registration throttle now keys on the LAST `X-Forwarded-For` entry (first entries are spoofable).
- **MEDIUM**: competition join codes use `secrets` (CSPRNG) instead of `random`.
- **MEDIUM**: password reset now blacklists outstanding refresh tokens, sends mail asynchronously (kills the SMTP timing oracle), returns a uniform error, and validates password strength (as do registration and password changes).
- **LOW**: `organizer_assigns_teams` enforced in join/create team views; email changes reset `is_verified`; `JoinTeamView` rejects non-numeric ids; public usernames no longer derived from the email local-part; nginx security headers fixed for `/media/` + `/apistatic/` (inheritance no longer broken by `add_header`).
- `requirements.txt` malformed `py-vapid…Pillow` line fixed.

### Performance (audit, 2026-07-31)
- Initial JS bundle **250 kB → 143 kB gzip (-43%)**: Sentry SDK and React Query devtools only load when needed (dynamic imports).
- `lodash` full-package imports replaced with per-method imports on the dashboard and competition pages.
- DB indexes: `Workout (user, start_datetime)` (per-workout save lookups + dashboards) and `DrillInstructorMessage (config, posted_at)` (coach feed) - new migrations `workouts/0003`, `drill_instructor/0005`.
- nginx: content-hashed `/static/` assets cached 30 d, personas/fonts 7 d, HTML shell never cached; security headers preserved on all locations (see Security).

### Added (2026-07-31)
- **Registration invite token** - when `REGISTRATION_TOKEN` is set (env, git-ignored), new signups must provide the token (`invite_token` field, constant-time comparison, field-level error). Unset = open registration (backwards compatible). Registration form gained the Invite Token input.

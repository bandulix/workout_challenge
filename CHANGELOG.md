# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Arbitrary points minting closed** — `POST /api/point/` was a full `ModelViewSet` whose permission class lets any authenticated user through while `create()` never runs object-level checks, so anyone could forge `points_raw`/`points_capped` for any goal and any (even someone else's) workout. The endpoint is now read-only; points are computed exclusively by the scorer.
- **Stats cache no longer bypasses authorization** — `CompetitionStatsQueryView` is wrapped in `cache_page(30)`, and the competition-membership check only ran inside the view body, so on a cache hit any authenticated user could read the stats of a competition they don't participate in. The check now lives in `has_permission`, which DRF runs before the cache lookup.
- **Cross-account workout takeover via Strava sync closed** — `sync_strava` updated any existing workout matching a `strava_id` (unique across the whole table) and reassigned it to the syncing user. It now only touches workouts the syncing user actually owns.
- **Strava refresh tokens encrypted at rest** — they were stored plaintext while Garmin tokens were already Fernet-encrypted. Both now go through the shared `custom_user/token_crypto.py` (key from `GARMIN_TOKEN_KEY` or `SECRET_KEY`); existing plaintext rows keep working and are re-saved encrypted on their first successful use. Migration `custom_user/0006` widens the column for the ciphertext.
- **Container hardening** — gunicorn, celery worker/beat and Flower now run as an unprivileged `app` user and Redis as the `redis` user (previously everything ran as root); the container drops all capabilities and adds back only what it needs (`NET_BIND_SERVICE`, `SETUID`/`SETGID`, `CHOWN`, `DAC_OVERRIDE`) plus `no-new-privileges`. Gunicorn binds loopback (nginx proxies internally) and is no longer published to the host; the unauthenticated supervisord web UI binds loopback inside the container and its host port mapping is removed (use `docker compose exec workoutchallenge supervisorctl -c /etc/supervisord.conf status`); Redis binds localhost only.
- **Flower requires basic auth** — the task-monitoring UI exposed task payloads and controls without any login. It now defaults to `admin` / your `SECRET_KEY` (override with `FLOWER_USER` / `FLOWER_PASSWORD`).
- **`SECRET_KEY` required, `DEBUG` off by default** — docker-compose refused neither the publicly-known dev key nor `DEBUG=true` before; both are now hard/opt-in like `POSTGRES_PASSWORD`.
- **Stricter Content-Security-Policy** — `script-src` no longer allows `'unsafe-inline'`: the frontend builds with `INLINE_RUNTIME_CHUNK=false` and the pre-paint theme bootstrap moved to the external `/theme-init.js`. Also: `server_tokens off`, and the `/api/` error log dropped from `debug` (it recorded join-token URLs) to `warn`.
- **JWTs no longer written to the browser console** — three auth-flow log lines printed the full access token, which Sentry breadcrumbs would have shipped off-site on any error.
- **Authenticated API cache purged on logout** — the service worker keeps `/api/*` responses as an offline fallback; they are now deleted on logout so a shared device can't read the previous user's data.
- **GitHub Actions pinned to commit SHAs** — all workflow actions (checkout, docker setup-qemu/buildx/login/build-push, github-tag-action) were mutable tags that a supply-chain repoint could use to exfiltrate DockerHub credentials or push to the repo; they are now SHA-pinned, `actions/checkout` upgraded v2/v3 → v4, and every job declares a minimal `permissions:` block.
- **Smaller fixes** — user-controlled path segments are URL-encoded in the join/Strava-link API calls, all `target="_blank"` links carry `rel="noopener noreferrer"`, password-reset lookup is case-insensitive (mixed-case registrations previously never got the email), Strava API calls have hard timeouts, sync logs no longer print user email addresses, and the dev DB-clean script no longer deletes files inside the machine's installed Django packages.

### Changed
- **Strava & Garmin now sync every hour** — the beat schedule was once per day (04:44 / 04:54) and both sync tasks additionally skipped any user synced within the last 6 hours, so a workout could take over a day to show up. The `strava_sync` / `garmin_sync` PeriodicTasks now run hourly (:44 / :54, kept 10 minutes apart so they never compete for the worker) and the per-user throttle is lowered to 55 minutes, so activities land in the app at most ~1 hour after recording. Strava API usage stays far below the rate limits (one list request per user per run; detail requests only for new activities).
- **Login now lasts a month of inactivity** — the JWT refresh token lifetime was raised from 5 to 31 days (`JWT_REFRESH_DAYS` env var). With token rotation the validity re-extends on every app use, so active users never see the login screen again; a login is only required after ~1 month without opening the app. Existing sessions pick up the new lifetime automatically at their next refresh.

### Removed
- **Postgres host port mapping** — the `database` service no longer publishes `5432` to the host; it was optional and only used for host-side `psql`. The `POSTGRES_BIND` / `POSTGRES_HOST_PORT` env vars are gone with it. If a running deployment previously relied on the mapping, connect via `docker compose exec database psql -U postgres workoutchallenge` instead (and delete the two vars from your `.env` if you added them).

### Added
- **Invite-link registration** — when `REGISTRATION_TOKEN` is set, a valid competition join code (from a shared invite link `?join=<code>`) now doubles as the registration invite: recipients can sign up without typing the global invite token and land straight in the join dialog. The 400 error intentionally does not reveal whether the token or the join code was wrong, and the 20/hour/IP registration throttle still applies. Registration form marks the token optional when an invite link is detected; the share modal notes that no token is needed.

### Fixed
- **502 on every API call after the hardening release** — the container hung at boot and nginx answered all `/api/*` requests with `502 Bad Gateway` (login showed "Bad Gateway (502) - Unknown error"). Two faces of the same `localhost` trap: in the Alpine image `/etc/hosts` maps `localhost` to both `127.0.0.1` and `::1`, and busybox `nc` probes the IPv6 address first. Redis and gunicorn bind the IPv4 loopback only, so the supervisord readiness probes (`nc -z localhost …`) were refused on `::1` and gunicorn/celery/flower waited for Redis forever; likewise nginx round-robined the two resolved addresses for `proxy_pass http://localhost:8000` and logged a refused `::1` upstream on every other attempt. All probes and the proxy upstream now use `127.0.0.1` explicitly. Also silenced the cosmetic `[ERROR] Control server error: Permission denied: '/root/.gunicorn'` on boot (gunicorn 26 creates its management socket under `$HOME`, which supervisord leaves as root-owned `/root` for the `app` user) by passing `--no-control-socket` — supervisord owns the process lifecycle, the socket was unused.
- **Leaderboard profile pictures broken** — `competition/stats.py` built the image URL as `f"/{settings.MEDIA_URL}…"`, but Django's `LazySettings` already prepends the script prefix to `MEDIA_URL` (runtime value is `/media/`), so the API returned `//media/profile_pics/…`. A leading `//` is a protocol-relative URL - the browser tried to download the avatar from a host literally named `media` and showed a broken image.
- **Drill Instructor silently fell back to static messages** — every LLM failure (missing API key, rejected base URL, provider error, empty reply) was swallowed and the coach posted the static `"{persona}: nice work…"` template, which read as "the persona change isn't applied" / "the messages aren't AI". `generate_message` now returns the failure reason and the tasks store it in `config.last_error`, which the Drill Instructor config UI already shows ("Last error: …"); it clears again on the next successful generation. Also fixed the MiniMax provider preset, which pointed at a hallucinated `api.MiniMax.chat` host - the official OpenAI-compatible endpoint `https://api.minimax.io/v1` (with `MiniMax-M3`) works, including MiniMax subscription (`sk-cp-…`) keys; `<think>…</think>` reasoning blocks that MiniMax M3 embeds in responses are stripped so the coach never posts its internal monologue.
- **Stale Drill Instructor state across sessions** — the drill-instructor RTK slice (12 h cache, persisted to `localStorage`) was the only auth-adjacent slice never reset on login/logout/registration, so a previous session's configs/messages could linger ("coach not configured" or an old persona shown after it was changed). It's now reset together with the other slices.
- **"Please refresh" errors on long-open tabs** — the service worker now goes **network-first for everything** (HTML, `/api/*`, static assets) and only touches the cache when the network actually fails, so while the device is online the app is always realtime. Caches are long-lived runtime caches trimmed by entry count instead of being purged on every release (that purge was what broke tabs open across a redeploy: their hashed JS chunks vanished → chunk-load errors). Additionally: a redeployed server that no longer has an old chunk is answered with the cached copy instead of a 404, the frontend checks for service-worker updates hourly + on tab focus and reloads once automatically when one activates, and a global ChunkLoadError handler reloads once as a last-resort safety net (loop-guarded).
- **Menu bar visible on the login screen** — the bottom navigation was only hidden on public pages when no access token existed, so a still-logged-in device landing on `/login` showed the bar. It is now hidden on all public pages (`/`, `/login`, `/signup`, `/logout`, `/password*`) regardless of token state.
- **Devices out of sync for hours** — the Redux/RTK Query caches are persisted to `localStorage` and the competitions/workouts lists only refetched when the cache was older than 3 hours (polling likewise every 3 h), so a second device could show a stale (e.g. empty) challenge list long after joining on another device. Mount-refetch and dashboard polling for competitions + workouts now happen at 60-second intervals; the drill-instructor slice (whose stale state read as "the app forgot my activation") refetches after 60 seconds too, and a failed config save now raises a loud alert instead of only a small inline error.
- **PWA scrollbars hidden in standalone mode** — when the app runs installed (`display-mode: standalone`), all scrollbars are hidden for a native-app feel; browser/desktop mode keeps the slim themed scrollbars.
- **Strava link showed a bare "parsing error"** — any non-HTTPError failure in the post-link workout import (`sync_strava` task crash, unreachable worker) produced a 500 HTML page that the frontend couldn't parse. `LinkStravaView` now returns a clean JSON 502 ("linked, but import failed") and logs the traceback. Additionally, the flow can no longer leave with an empty OAuth `state`: the link page never renders/redirects without it (shows a real error if the session expired), the return page reports a missing state properly, and `strava/link/<code>/` (no state) now hits the view as JSON 400 instead of a bare 404 HTML page.
- **Browser push subscription failed with `atob` error** — auto-generated/persisted VAPID public keys were stored in PEM form, but `PushManager.subscribe()` needs the raw 65-byte EC point in base64url. `push_notifications/vapid.py` now normalises every key source (generation, `vapid.json`, env vars) to base64url and rewrites healed `vapid.json` files; PEM env keys keep working. Fixes "Failed to execute 'atob' on 'Window'" on Android/iOS/desktop.
- **Fresh clones could not migrate** — `.gitignore` swallowed all of `src-backend/data/` including `data/db_migrations/` (the runtime migration modules for `competition` / `custom_user` / `workouts` referenced by `MIGRATION_MODULES`), so a fresh clone crashed at `migrate` with "Dependency on app with no migrations". The ignore rule is narrowed and the migration modules are now tracked (`.dockerignore` already shipped them into the image). After pulling this fix on an existing deployment, remove the stale empty `django_data` volume once (`docker volume rm <projekt>_django_data`) so it is re-seeded from the image.
- **Stale Matrix references** — the CHANGELOG still described the removed Matrix integration (homeserver/room config, MXID mentions, `matrix_client`); entries rewritten to match the in-app audit log + push design, with a proper "Removed" note, and matching Matrix leftovers cleaned from `llm_client.py` comments and the workout prompt.
- **Host port exposure** — Postgres is no longer exposed to the host at all (the app reaches it over the internal compose network; use `docker compose exec database psql -U postgres` for manual access), and the debug/monitoring ports (Flower `5555`, gunicorn `8000`, supervisord `9001`) bind to localhost by default (`DEBUG_BIND` env var), fixing collisions with a host-installed Postgres and preventing unauthenticated public exposure on VPS deployments.
- **Config plumbing gaps** — `GARMIN_TOKEN_KEY` was documented in the README but never actually read from the environment: `settings.py` now maps it (falling back to a SECRET_KEY-derived key) and `docker-compose.yml` / `.env.example` pass it through. `render_config_js.py` now also exposes `REACT_APP_VAPID_PUBLIC_KEY` via `window.RUNTIME_CONFIG` as documented (the `/api/push/status/` fallback still covers auto-generated keypairs). `docker-compose.yml` gained a header pointing at the fork repository and OCI `org.opencontainers.image.source` labels on the image and container.
- **Quiet-day nudges** — the Drill Instructor now speaks up on its own when a running competition sees zero workouts in a day.
  - New `DrillInstructorConfig.nudge_on_inactivity` toggle (default on) and `DrillInstructorMessage.kind` (`activity` / `test` / `nudge`) with migration `drill_instructor/0006`.
  - New Celery task `drill_instructor.tasks.post_inactivity_nudges` + `build_inactivity_prompt`: daily 17:10 sweep posts one persona-voiced, group-addressed nudge per quiet competition (idempotent - one per competition per day; skipped as soon as anyone logs a workout). When the config's push toggle is on, the nudge is pushed to every subscribed participant.
  - Beat runs the `DatabaseScheduler`, so migration `drill_instructor/0007` seeds the matching `PeriodicTask` row (the static `beat_schedule` entry in celery.py is documentation-only there).
  - Config UI gains a "Nudge when the group goes quiet" checkbox; the Coach feed labels nudges with a "quiet-day nudge" chip.
- **AI Drill Instructor** — per-competition optional AI coach that comments on every logged workout in a chosen persona voice.
  - New `drill_instructor` Django app: `DrillInstructorPersona`, `DrillInstructorConfig`, `DrillInstructorMessage`.
  - Four built-in global personas (Drill Sergeant, Cheerleader, British Butler, Zen Master) seeded on first start.
  - Owner-only competition settings UI to pick a persona, toggle comment-on-activity and browser push, send a test message, and remove the config.
  - Celery task `post_workout_comment` is enqueued from `competition/scorer.py:trigger_workout_change` after point recalculation.
  - New REST endpoints: `/api/drill-instructor/persona/`, `/api/drill-instructor/config/`, `/api/drill-instructor/message/`, and `POST /api/drill-instructor/config/<id>/test/`.
- **LLM provider configuration** — `OPENAI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_EMAIL_MODEL` env vars, with the same client reused by the Drill Instructor and the weekly email AI fact. Any OpenAI-compatible provider (OpenRouter, Groq, Together, Mistral, Ollama, …) works via `base_url`.
- **LLM provider preset** — new `llm_provider` Site Settings field (and `LLM_PROVIDER` env var) with a `MiniMax` option that auto-fills `base_url=https://api.MiniMax.chat/v1` and `model=MiniMax-M3`. The provider preset can still be overridden per-field in the admin UI.
- **AI Drill Instructor personalities** — rewrote Drill Sergeant to roast laggards + mock the leader, and added a new "Roast Master" persona (savage but affectionate NBA-banter style). Workout prompt now includes the leader's total points and the gap to the leader so trash-talk personas can reference real standings instead of inventing numbers.
- **Site Settings** — new `site_settings` Django app holding a singleton `SiteSettings` row editable at runtime.
  - Three sections in the UI: **LLM / AI provider**, **Strava**, **SMTP / Outbound Email**.
  - All secrets (`llm_api_key`, `strava_client_secret`, `email_host_password`) are write-only on the API; the read path returns a masked preview.
  - Resolution order is **DB → environment variable** so admin edits take effect without restarting workers.
  - `site_settings/models.py:resolve_llm_settings()` / `resolve_strava_settings()` / `resolve_email_settings()` are the single entry points.
- **First-user-is-admin** — `custom_user/models.py:CustomUser.save()` automatically promotes the very first registered user to `is_staff=True` and `is_superuser=True` inside `transaction.atomic()` with `select_for_update()` to avoid a race.
- **Admin page** at `/admin/site-settings` — React + RTK Query, accessible only to staff (shield icon in top nav).
  - "Manage Personas" button on My Space opens the persona library modal (create / edit / delete; built-in personas can't be deleted).
- **Mobile / PWA**
  - `public/manifest.json` upgraded: `display: standalone`, `orientation: portrait`, `theme_color: #0c4a6e`, SVG icons (192, 512, **maskable**), `start_url` + `scope`.
  - `public/icon-192.svg`, `public/icon-512.svg`, `public/maskable-icon.svg`.
  - `public/sw.js` service worker: network-first everywhere (HTML, `/api/*`, static assets) with the cache used purely as offline fallback, dedicated `/offline.html` page, push notification handler.
  - `public/index.html` gains `viewport-fit=cover`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, and iOS safe-area CSS.
  - `src/utils/bottomNav.js` — mobile-only bottom tab bar (Home, Compete, **Log** FAB, Me/Admin) with safe-area padding.
  - `utils/miscellaneous.js:PageWrapper` adds `pb-24 md:pb-6` so content clears the bottom nav.
  - `forms/basicComponents.js` — icon-only buttons enforce `min-h-[44px] min-w-[44px]`; `FormInput` emits `inputMode="decimal"` / `"email"` and `enterKeyHint` for mobile keyboards.
  - `App.js` — `MySpace`, `Competition`, `AdminSettings` lazy-loaded with `<Suspense>` so the initial bundle stays small.
- **Browser push notifications**
  - New `push_notifications` Django app: `PushSubscription` model, subscribe/unsubscribe/status endpoints, VAPID keypair management with auto-generation persisted to `DATA_DIR/vapid.json` (mode `0o600`).
  - Optional per-competition `send_push_on_activity` toggle on `DrillInstructorConfig`. The Drill Instructor Celery task fans out via `pywebpush` to every subscribed device of the participant.
  - `index.js` exports `subscribeToPush()` / `unsubscribeFromPush()` helpers. "Enable browser notifications" button in the Site Settings form. `REACT_APP_VAPID_PUBLIC_KEY` injected via `window.RUNTIME_CONFIG`.
- **Security & performance audit** (full pass over the changes above):
  - SSRF guard on the LLM base URL (HTTPS required; literal-loopback allowed for self-hosted dev; private/loopback/link-local/multicast/reserved DNS resolutions blocked).
  - Push-subscribe endpoint refuses to hijack another user's endpoint with a `409 Conflict`.
  - Built-in persona writes locked to staff to prevent prompt-injection via the `system_prompt`.
  - Email subject stripped of CR/LF to defeat SMTP header injection.
  - Drill Instructor test message body capped at 1000 chars.
  - Push-notification `notificationclick` restricted to same-origin URLs (open-redirect fix).
  - Sentry request context redacts passwords and secrets before reporting.
  - Persisted Redux state scrubs the same allow-list before writing to `localStorage`.
  - `_user_rank()` rewritten to use three small queries instead of a Python loop.
  - Push fan-out parallelised with `ThreadPoolExecutor`.
  - Pre-existing bug `trigger_recalc_points` (missing parentheses) in `competition/scorer.py:156` fixed.
  - Resource Timing cache added to `baseQueryWithReauth.js`.

### New dependencies
- `pywebpush>=2.0.0` (Web Push delivery).
- `py_vapid` (VAPID keypair generation).
- `requests` was already present; used by `pywebpush`.

### New env vars
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (auto-generated if unset).
- `LLM_BASE_URL`, `LLM_MODEL` (default `gpt-4o-mini`), `LLM_EMAIL_MODEL` (default `gpt-4o`).

### New database tables (auto-created via `makemigrations`)
- `drill_instructor_drillinstructorpersona`, `drill_instructor_drillinstructorconfig`, `drill_instructor_drillinstructormessage`.
- `site_settings_sitesettings` (singleton row, pk = 1).
- `push_notifications_pushsubscription`.

### New API endpoints
- `GET/PUT /api/site-settings/` (admin only).
- `GET/POST/PATCH/DELETE /api/drill-instructor/persona/`.
- `GET/POST/PATCH/DELETE /api/drill-instructor/config/`.
- `GET /api/drill-instructor/message/`.
- `POST /api/drill-instructor/config/<id>/test/` (competition owner).
- `GET /api/push/status/`, `POST /api/push/subscribe/`, `POST /api/push/unsubscribe/`.

### New Django admin entries
- `Site Settings` (singleton).
- `Drill Instructor Persona`, `Drill Instructor Config`, `Drill Instructor Message`.
- `Push Subscription`.

### Frontend routes / components
- `/admin/site-settings` → `AdminSettings` (lazy).
- "Manage Personas" button on My Space opens `DrillInstructorPersonaModal`.
- "AI Drill Instructor" button on every competition (owner only) opens `DrillInstructorConfigForm`.
- Bottom navigation on small screens.
- New RTK Query slices: `drillInstructorApi`, `siteSettingsApi`, `pushApi`.

### Migration notes
- `drill_instructor/0001_initial.py` and `site_settings/0002_*` were generated by `makemigrations` and committed.
- `site_settings/0001_initial.py` lives in source because the new app uses source-tree migrations (not the runtime redirect that the older apps use).
- `drill_instructor` migrations live in source for the same reason.
- `push_notifications` migrations live in source for the same reason.

### Files added
```
src-backend/drill_instructor/{__init__,apps,models,serializers,views,admin,tasks,
                              llm_client,seed,migrations/*}.py
src-backend/site_settings/{__init__,apps,models,serializers,views,admin,
                          migrations/*}.py
src-backend/push_notifications/{__init__,apps,models,serializers,views,admin,
                               sender,vapid,migrations/*}.py
src-frontend/public/{icon-192.svg,icon-512.svg,maskable-icon.svg,sw.js,offline.html}
src-frontend/src/pages/AdminSettings.js
src-frontend/src/forms/{drillInstructorConfigForm,drillInstructorPersonaModal,
                        siteSettingsForm}.js
src-frontend/src/utils/reducers/{drillInstructorSlice,siteSettingsSlice,pushSlice}.js
src-frontend/src/utils/bottomNav.js
```

### Security notes
- All secrets are write-only on the REST API; reads return masked previews.
- SSRF protection on the outbound admin-controlled LLM base URL.
- Push subscriptions are scoped to the authenticated user; cross-user hijacking returns `409 Conflict`.
- Built-in persona writes restricted to staff.
- VAPID private key on disk is `chmod 0o600`.
- SMTP subject stripped of CR/LF.
- Push-notification `notificationclick` refuses cross-origin URLs.

### Known gaps (not fixed in this release)
- `SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOW_ALL_ORIGINS` defaults in `settings.py` are unchanged.
- JWT tokens live in `localStorage` (XSS-exfiltrable). Moving to httpOnly cookies would be a larger refactor.
- `api_rate_limiter` is per-process; multi-worker deployments need Redis-backed counters.
- LLM, Strava and SMTP secrets are stored plaintext in `site_settings_sitesettings`. Encryption at rest would need a key-management story.
- `CustomUser.get_strava_auth_url` still embeds the user `pk` in the Strava `redirect_uri`; a signed state token would be safer.
---

## Fork changes (bandulix/workout_challenge), 2026-07
The following changes were made in the fork on top of the state above
(original project: vanalmsick/workout_challenge, SSPL v1 - see LICENSE and NOTICE).

### Added
- **Drill Instructor persona identities** — `DrillInstructorPersona.tagline`, `.avatar`, `.theme_color` (+ migration `drill_instructor/0004_persona_identity`). Built-in personas seeded with taglines/colours; avatar artwork (10 hand-crafted SVGs) ships in `src-frontend/public/personas/`. Persona serializer validates artwork key vs. single emoji and hex colour; message serializer is enriched with persona/competition/athlete/workout-summary fields; message list is filterable by `?competition=`.
- **Coach page** (`/coach`, lazy-loaded): persona hero card with latest message speech bubble, live "coach wire" chat feed with day separators, persona roster with detail modal, platform-aware push opt-in card (iOS Add-to-Home-Screen guidance, Android `beforeinstallprompt`).
- **Coach's Corner** on the competition page (latest messages + owner setup CTA).
- **Profile picture upload** — `CustomUser.profile_picture` `ImageField` (+ migration `custom_user/0004`), 5 MB / image-only validation, `MEDIA_ROOT` in the data volume, nginx `/media/` location, old files auto-deleted on replacement. Editable avatar component on the dashboard and in the Me sheet.
- **Garmin Connect import** (parallel to Strava): `custom_user/garmin.py` with Fernet-encrypted token storage (`GARMIN_TOKEN_KEY` override, password never stored), `Workout.garmin_id` (+ migrations `custom_user/0005`, `workouts/0002`), `POST /api/garmin/link|unlink`, `GET /api/garmin/sync` (hourly), daily beat task at 04:54, ~60 activity-type mappings, Settings UI section and a "Re-Sync with Garmin" button.
- **Theme system** — `utils/theme.js` with light/dark/system modes, class-based `.dark`, boot script in `index.html` preventing flash-of-wrong-theme, toggle in the Me sheet.
- **PWA assets** — PNG icons (192/512/**maskable**/apple-touch) and monochrome Android notification badge generated as volt-bolt artwork; self-hosted fonts (Inter variable + Archivo Black) in `public/fonts/`; manifest app shortcuts ("Log a workout", "Coach"); service worker bumped to `wc-v2` caching fonts + persona artworks and showing persona icons in push notifications.
- `Pillow>=10.0.0`, `garminconnect>=0.2.0`, `cryptography>=41.0.0` dependencies.

### Changed
- **Full visual redesign ("volt/ink")** — tailwind theme extended (brand palette, display font, glow shadows, animations); all shared primitives (BoxSection, PageWrapper, Modal, buttons, inputs) restyled; public/auth pages re-themed (dark hero with persona strip); dashboard reordered (My Workouts directly under the welcome block); 30-day stats + personal goals redesigned as mini-cards; streak calendar replaced by a compact Streak Card (week streak, current-week dots, WHO 150-min bar).
- **Navigation** — top `NavMenu` removed entirely; dark bottom navigation (floating dock on desktop) with the Coach persona avatar at centre; "Me" bottom sheet hosting Settings, Goal Equalizer, theme toggle, Help, Admin and Logout; competition picker bottom sheet.
- **Push payloads** now carry persona icon/badge/tag; subscribe flow reads the VAPID key from `/api/push/status/`.
- nginx: `/media/` location + 120 s API proxy timeouts (Garmin SSO roundtrip).

### Removed
- First-login tutorial (`HowToScreen`) and the `?welcome=` onboarding chain; registration no longer sets the welcome flag.
- Legacy "Manage Personas / Goal Equalizer / Settings" buttons from the welcome block (moved to Coach page / Me sheet).
- Broken `critters-webpack-plugin` (build failed with "Could not find HTML asset" on CRA 5 / webpack 5); critters dev-dependencies dropped.
- `Dashboard.css`, `utils/navMenu.js` (dead after redesign).
- **Matrix integration** — the Drill Instructor's original Matrix-room posting (homeserver / access token / room id config, `CustomUser.matrix_user_id`, MXID mention rewriting, `matrix_client.py`) was dropped in favour of the in-app audit log + web push; migration `drill_instructor/0003_drop_matrix_fields`.

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

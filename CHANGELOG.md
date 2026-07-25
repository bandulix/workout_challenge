# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **AI Drill Instructor** — per-competition optional integration with a Matrix room.
  - New `drill_instructor` Django app: `DrillInstructorPersona`, `DrillInstructorConfig`, `DrillInstructorMessage`.
  - Four built-in global personas (Drill Sergeant, Cheerleader, British Butler, Zen Master) seeded on first start.
  - Owner-only competition settings UI to pick a persona, paste a Matrix homeserver / access token / room id, toggle comment-on-activity, send a test message, and remove the config.
  - Celery task `post_workout_comment` is enqueued from `competition/scorer.py:trigger_workout_change` after point recalculation.
  - New REST endpoints: `/api/drill-instructor/persona/`, `/api/drill-instructor/config/`, `/api/drill-instructor/message/`, and `POST /api/drill-instructor/config/<id>/test/`.
- **LLM provider configuration** — `OPENAI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_EMAIL_MODEL` env vars, with the same client reused by the Drill Instructor and the weekly email AI fact. Any OpenAI-compatible provider (OpenRouter, Groq, Together, Mistral, Ollama, …) works via `base_url`.
- **Site Settings** — new `site_settings` Django app holding a singleton `SiteSettings` row editable at runtime.
  - Three sections in the UI: **LLM / AI provider**, **Strava**, **SMTP / Outbound Email**.
  - All secrets (`llm_api_key`, `strava_client_secret`, `email_host_password`, `matrix_access_token`) are write-only on the API; the read path returns a masked preview.
  - Resolution order is **DB → environment variable** so admin edits take effect without restarting workers.
  - `site_settings/models.py:resolve_llm_settings()` / `resolve_strava_settings()` / `resolve_email_settings()` are the single entry points.
- **First-user-is-admin** — `custom_user/models.py:CustomUser.save()` automatically promotes the very first registered user to `is_staff=True` and `is_superuser=True` inside `transaction.atomic()` with `select_for_update()` to avoid a race.
- **Admin page** at `/admin/site-settings` — React + RTK Query, accessible only to staff (shield icon in top nav).
  - "Manage Personas" button on My Space opens the persona library modal (create / edit / delete; built-in personas can't be deleted).
- **Mobile / PWA**
  - `public/manifest.json` upgraded: `display: standalone`, `orientation: portrait`, `theme_color: #0c4a6e`, SVG icons (192, 512, **maskable**), `start_url` + `scope`.
  - `public/icon-192.svg`, `public/icon-512.svg`, `public/maskable-icon.svg`.
  - `public/sw.js` service worker: network-first for HTML and `/api/*` (5 s timeout → cache), cache-first with background revalidate for static assets, dedicated `/offline.html` fallback, push notification handler.
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
  - SSRF guards on Matrix homeserver and LLM base URL (HTTPS required; literal-loopback allowed for self-hosted dev; private/loopback/link-local/multicast/reserved DNS resolutions blocked).
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
- `requests` was already present; used by the Matrix client and `pywebpush`.

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
                              matrix_client,llm_client,seed,migrations/*}.py
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
- SSRF protection on every outbound user-controlled URL (Matrix homeserver, LLM base URL).
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
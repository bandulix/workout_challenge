# Workout Challenge

> ### ⚠️ This is a fork
> **Original project:** [vanalmsick/workout_challenge](https://github.com/vanalmsick/workout_challenge) — Copyright © 2025 [github.com/vanalmsick](https://github.com/vanalmsick).
> This fork is maintained at [bandulix/workout_challenge](https://github.com/bandulix/workout_challenge).
> Both the original and this fork are licensed under the **Server Side Public License v1 (SSPL)** — see [LICENSE](LICENSE) (unmodified, original copyright preserved). What this fork changes is documented below in [**Changes from the original**](#changes-from-the-original), in [NOTICE](NOTICE), and in [CHANGELOG.md](CHANGELOG.md).

No matter if a healthy close your rings competition with friends or a September steps challenge with work colleagues, this webapp enables you to compete with friends and co-workers across devices (Apple / Android / Garmin / etc.) using the metrics you want to use (km / minutes / kcal / # of times / etc.) respecting your privacy. Participants can either add their workouts and/or steps manually or link their free Strava or Garmin Connect account for automatic workout import. 

## Changes from the original
This fork extends [vanalmsick/workout_challenge](https://github.com/vanalmsick/workout_challenge) (base: `main` @ `256e5b1`) with the following changes, grouped by topic. Everything below remains under the same SSPL v1 license; the original copyright is untouched.

**🎖️ AI Drill Instructor (new feature)**
- Per-competition, owner-configured AI coach that comments on every logged workout in a chosen persona voice (LLM via any OpenAI-compatible provider; runtime-configurable in Site Settings).
- Personas have **profile pictures, taglines and accent colours** - 10 hand-crafted avatar artworks ship in `src-frontend/public/personas/`, custom personas can pick artwork or an emoji plus a colour.
- Generated messages live in an in-app audit log (REST: `/api/drill-instructor/*`) and can be pushed to athletes' devices via web push.

**📱 Coach-centred PWA redesign (mobile-first)**
- New visual language: dark athletic "volt/ink" theme, Archivo Black + Inter (self-hosted for offline use), rounded-3xl cards, class-based dark mode with a manual toggle.
- New **Coach page** (`/coach`): persona hero with speech bubble, live chat-style "coach wire" feed, persona roster, platform-aware push opt-in (incl. the iOS Add-to-Home-Screen flow).
- Navigation rebuilt: top nav removed; dark bottom bar (floating dock on desktop) with the **Coach persona's avatar at centre stage** and a **Me sheet** (Settings, Goal Equalizer, theme, Help, Admin, Logout).
- PWA hardening: PNG icons incl. maskable + monochrome Android notification badge, manifest shortcuts, service worker `wc-v2` (shell + fonts + persona artworks cached, persona icons inside push payloads), restyled offline page, `Coach's Corner` on every competition page.

**🏠 Home / profile**
- Dashboard reordered (My Workouts directly under the welcome block), 30-day stats and personal-goal blocks redesigned, streak calendar replaced by a compact **Streak Card** (week streak, current-week dots, WHO 150-min progress).
- **Profile picture upload** (editable avatar; `ImageField` + nginx `/media/` serving, old files auto-deleted).
- First-login tutorial removed; the public pages were re-themed.

**⌚ Garmin Connect import (new connector, parallel to Strava)**
- Link Garmin in Settings; password is used once and never stored - only the encrypted OAuth token blob (Fernet) is kept. Daily sync via Celery beat plus a manual hourly re-sync; ~60 Garmin activity types mapped; de-duplication by activity id. See [Automatic Garmin Connect Import](#automatic-garmin-connect-import).

**🔧 Site & infra**
- **Site Settings** runtime admin (LLM / Strava / SMTP sections, DB-over-env resolution, write-only secrets), **first-user-is-admin** bootstrap, admin page at `/admin/site-settings`.
- **Web push** backend (VAPID auto-keypair, subscription registry, parallel sender).
- Build fixes: removed the broken `critters-webpack-plugin`; added missing migrations.

## How does it work?
Create your own competition or use a friend’s invitation link to join their competition, enter your workouts manually or link your Strava for automatic workout import, and enjoy the competition. You can customize each competition's activity goals individually. Participants earn 1 point for every 1% progress towards a goal. For example, if the goal is 100 minutes of exercise and you work out 50 minutes, you earn 50 points. Additionally, you can cap / floor the maximum / minimum points participants can earn per workout / day / week to e.g. ensure a healthy competition that is focused on consistency.

**Features:**
- Create your own competition or use a friend’s invitation link to join their competition
- Enter workouts manually or import them automatically via Strava or Garmin Connect (daily at 4 AM)
- Your personal dashboard shows workout stats and your workout streak
- The competition dashboards show friends’ workouts, leaderboards, and your progress towards the competition goals
- A weekly email on Mondays shows you your spot on the competition leaderboards
- An optional weekly email on Thursday shows your progress against your personal goals
- Fully responsive website and emails (mobile, tablet, desktop)
- Light and dark mode

**Competition Goal Choices:**  
*Create one or several goals for your competition.*
- **Metrics:** time (minutes) / number of times (#) / distance (km) / calories (kcal) / kilojoules (kj)
- **Period:** per day / per week / per month / during the entire competition
- **Limits:** min / max per workout, min / max per day, min / max per week

### Your Personal Dashboard:
![Preview Dashboard](/docs/imgs/preview-myspace-light.png)

### Competition Dashboards:
![Preview Competition](/docs/imgs/preview-competition-both.png)


### Automatic Strava Workout Import:
![Preview Strava Import](/src-frontend/public/how_to_strava_sync.png)

### Automatic Garmin Connect Import:
Link your Garmin Connect account in **Me → Settings → Garmin Connect** and your recent activities are imported in the background, then daily at ~4:54 AM (plus a manual hourly-rate-limited **Re-Sync with Garmin** button under My Workouts). Notes:
- Your Garmin password is used **once** to obtain OAuth tokens and is **never stored** - only the encrypted token blob is kept (Fernet, key derived from `SECRET_KEY`, overridable via `GARMIN_TOKEN_KEY`).
- Activities are de-duplicated by their Garmin activity id, mapped to the matching sport types (trail run → TrailRun, indoor cycling → VirtualRide, ...), and scored with the same intensity heuristic as Strava imports.
- Accounts with **Garmin two-factor authentication can't be linked yet** - the link flow tells you so if that applies.
- If Garmin invalidates the stored tokens, the linkage is cleared automatically and you simply re-link in Settings.
- Under the hood this uses the community [garminconnect](https://github.com/cyberjunky/python-garminconnect) library, since Garmin's official Health API is enterprise-only.

<div align="center">

If you like <b>Workout Challenge</b>, consider giving it a **star** ⭐!  
Made with ❤️ in London  

<a href='https://ko-fi.com/vanalmsick' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi1.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>  
</div>


## Give it a quick try
```
docker run -p 80:80 -e HOSTS=http://localhost,http://127.0.0.1 -e DEBUG=true -e SECRET_KEY=some-long-random-string vanalmsick/workout_challenge
```

## Full Production Deployment
[**docker-compose.yml**](/docker-compose.yml)
```
version: '3.9'

services:
  workoutchallenge:
    image: vanalmsick/workout_challenge
    container_name: workoutchallenge
    ports:
      - "80:80"
      - "5555:5555" # Celery Flower task monitoring - do not open to public - only for local network for debugging
      - "9001:9001" # Supervisord process monitoring - do not open to public - only for local network for debugging
      - "8000:8000" # Django admin space - do not open to public - only for local network for debugging
    volumes:
      - /usr/pi/workout_challenge/django:/workout_challenge/src-backend/data
    environment:
      - POSTGRES_HOST=workoutchallenge-database
      - POSTGRES_DB=workoutchallenge
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
      - MAIN_HOST=http://your-url.com
      - HOSTS=http://your-url.com,http://localhost,http://127.0.0.1
      - SECRET_KEY=<your_random_string_for_encryption>
      - TIME_ZONE=Europe/London
      - STRAVA_CLIENT_ID=000000
      - STRAVA_CLIENT_SECRET=<secret_key>
      - SENTRY_DSN=https://<PUBLIC_KEY>@<HOST>/<PROJECT_ID>
      - EMAIL_HOST=smtp.gmail.com
      - EMAIL_PORT=465
      - EMAIL_HOST_USER=competition@yourdomain.com
      - EMAIL_HOST_PASSWORD=password
      - EMAIL_USE_SSL=True
      - EMAIL_USE_TLS=False
      - EMAIL_FROM=competition@yourdomain.com
      - EMAIL_REPLY_TO=support@yourdomain.com
      - OPENAI_API_KEY=<secret_key>
    restart: unless-stopped
    depends_on:
      database:
        condition: service_healthy

  database:
    image: postgres:15
    container_name: workoutchallenge-database
    environment:
      - POSTGRES_DB=workoutchallenge
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    ports:
      - "5432:5432"
    volumes:
      - /usr/pi/workout_challenge/postgres:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -U postgres" ]
      interval: 5s
      timeout: 5s
      retries: 5
```

```
docker compose -f /path/to/docker-compose.yml up
```

### Environment variables
| Variable              | Default                             | Definition                                                                                                                                                                                                                                                                                                      |
|-----------------------|-------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| MAIN_HOST             | "http://localhost"                  | The main hosting url for the Django backend.                                                                                                                                                                                                                                                                    |
| HOSTS                 | "http://localhost,http://127.0.0.1" | Comma seperated list of hosts for Django. This is used for [ALLOWED_HOSTS](https://docs.djangoproject.com/en/5.2/ref/settings/#allowed-hosts), [CORS_ALLOWED_ORIGINS](https://pypi.org/project/django-cors-headers/), and [CSRF_TRUSTED_ORIGINS](https://pypi.org/project/django-cors-headers/).                |
| SECRET_KEY            | [a hard-coded string in code]       | Django's [SECRET_KEY](https://docs.djangoproject.com/en/5.2/ref/settings/#std-setting-SECRET_KEY) for cryptographic signing.                                                                                                                                                                                    |
| TIME_ZONE             | "Europe/London"                     | Timezone for [Django](https://docs.djangoproject.com/en/5.2/ref/settings/#time-zone) and [Celery](https://docs.celeryq.dev/en/stable/userguide/configuration.html#timezone)                                                                                                                                     |
| DEBUG                 | false                               | Django's DEBUG mode. If true, [CORS_ALLOW_ALL_ORIGINS](https://pypi.org/project/django-cors-headers/) will also be true and the [CACHE](https://docs.djangoproject.com/en/5.2/ref/settings/#caches) will use [Local Memory Cache](https://docs.djangoproject.com/en/5.2/ref/settings/#caches) instead of Redis. |
| HOSTS                 | "http://localhost,http://127.0.0.1" | Comma separated list of hosts for Django. This is used for [ALLOWED_HOSTS](https://docs.djangoproject.com/en/5.2/ref/settings/#allowed-hosts), [CORS_ALLOWED_ORIGINS](https://pypi.org/project/django-cors-headers/), and [CSRF_TRUSTED_ORIGINS](https://pypi.org/project/django-cors-headers/). The historical `ALLOW_ALL_HOSTS=true` escape hatch has been removed because it combined with `CORS_ALLOW_CREDENTIALS` made credentialed cross-site requests trivially exploitable. For quick testing set DEBUG=true - that still requires a SECRET_KEY but doesn't fail otherwise. |
| POSTGRES_HOST         | None                                | If set to None, Django will use SQLite as database (might cause database lock errors in production), else this is the host url to the [Postgres database](https://hub.docker.com/_/postgres/).                                                                                                                  |
| POSTGRES_DB           | "postgres"                          | Database name in [Postgres database](https://hub.docker.com/_/postgres/)                                                                                                                                                                                                                                        | 
| POSTGRES_USER         | "postgres"                          | Database username in [Postgres database](https://hub.docker.com/_/postgres/)                                                                                                                                                                                                                                    | 
| POSTGRES_PASSWORD     | ""                                  | Database password in [Postgres database](https://hub.docker.com/_/postgres/)                                                                                                                                                                                                                                    | 
| SENTRY_DSN            | None                                | If None no [Sentry.io](https://sentry.io/) error capturing, else please provide the project url https://<PUBLIC_KEY>@<HOST>/<PROJECT_ID> *(In local development you might have to set REACT_APP_SENTRY_DSN instead)*                                                                                            | 
| STRAVA_CLIENT_ID      | "1234321"                           | [Strava API](https://developers.strava.com) Client Id. Please see below how to get one. *(In local development you might have to set REACT_APP_STRAVA_CLIENT_ID instead)*                                                                                                                                       | 
| STRAVA_CLIENT_SECRET  | "ReplaceWithClientSecret"           | [Strava API](https://developers.strava.com) Client Secret. Please see below how to get one.                                                                                                                                                                                                                     | 
| STRAVA_LIMIT_15MIN    | 100                                 | [Strava API](https://developers.strava.com) Limit per 15min. 300 if part of developer program, else 100.                                                                                                                                                                                                        | 
| STRAVA_LIMIT_DAY      | 1000                                | [Strava API](https://developers.strava.com) Limit per day. 3000 if part of developer program, else 1000.                                                                                                                                                                                                        | 
| REACT_APP_BACKEND_URL | ""                                  | Overwrite the url to the Django API used by React. This is intended for local development outside of the docker container - e.g. http://localhost:8000.                                                                                                                                                         | 
| EMAIL_HOST            | None                                | SMTP server host url to send out automated emails.                                                                                                                                                                                                                                                              | 
| EMAIL_PORT            | None                                | SMTP server port to send out automated emails.                                                                                                                                                                                                                                                                  | 
| EMAIL_HOST_USER       | None                                | SMTP server username to send out automated emails.                                                                                                                                                                                                                                                              | 
| EMAIL_HOST_PASSWORD   | None                                | SMTP server password to send out automated emails.                                                                                                                                                                                                                                                              | 
| EMAIL_USE_SSL         | False                               | SMTP server - if SSL ise used for authentication.                                                                                                                                                                                                                                                               | 
| EMAIL_USE_TLS         | False                               | SMTP server - if TLS ise used for authentication.                                                                                                                                                                                                                                                               | 
| EMAIL_FROM            | None                                | Sender email address of automated emails.                                                                                                                                                                                                                                                                       | 
| EMAIL_REPLY_TO        | None                                | Reply-To email address of automated emails.                                                                                                                                                                                                                                                                     | 
| OPENAI_API_KEY        | None                                | API key for the LLM provider used by the weekly email fact and the AI Drill Instructor. The OpenAI SDK is used, so any OpenAI-compatible endpoint works.                                                                                                                                                          |
| LLM_PROVIDER          | None                                | Preset for the admin-side provider selector. `MiniMax` auto-fills `LLM_BASE_URL=https://api.MiniMax.chat/v1` and `LLM_MODEL=MiniMax-M3`. Leave blank for the OpenAI default. Can also be picked in the Site Settings UI.                                                                                     |
| LLM_BASE_URL          | None (OpenAI default)               | Override the API endpoint - set to e.g. `https://openrouter.ai/api/v1`, `https://api.groq.com/openai/v1`, or `http://localhost:11434/v1` (Ollama) to use a non-OpenAI provider with the same SDK.                                                                                                          |
| LLM_MODEL             | "gpt-4o-mini"                       | Model used by the AI Drill Instructor. Pick any chat-completions model the configured provider serves.                                                                                                                                                                                                          |
| LLM_EMAIL_MODEL       | "gpt-4o"                            | Model used for the weekly email AI fact.                                                                                                                                                                                                                                                                       | 
| VAPID_PUBLIC_KEY      | (auto-generated)                    | VAPID public key for browser push notifications. If unset, a keypair is auto-generated on first start and persisted to `DATA_DIR/vapid.json`.                                                                                                                                                                    |
| VAPID_PRIVATE_KEY     | (auto-generated)                    | VAPID private key. Pin it via this env var if you don't want the keypair to drift on container rebuilds.                                                                                                                                                                                                       |
 | VAPID_SUBJECT         | "mailto:admin@example.com"          | `mailto:` (or `https://`) contact used in the VAPID claims.                                                                                                                                                                                                                                                    |

## AI Drill Instructor
Each competition can optionally activate an **AI Drill Instructor** that generates a short, persona-voiced comment every time a participant logs an activity. Generated messages are stored in the in-app audit log so the competition owner can read them back, and (optionally) sent as a web push notification to the athlete's devices.

### How to enable it (competition owner)
1. In My Space, click **Manage Personas** to review or edit the AI personas. The defaults (Drill Sergeant, Roast Master, Cheerleader, British Butler, Zen Master) are global and available to every competition.
2. On the competition page, click the new **AI Drill Instructor** button (owner only).
3. Pick a **Persona**, optionally enable browser push, and save.
   - **Display Name Prefix** (optional) — prepended like `[Drill Sergeant]` so people know it's the bot.
4. Toggle **Activated** and save. Use the **Send a test message** field to verify the configuration before relying on it.

### What it does
- For each new workout in the competition, the instructor generates a short, persona-voiced comment and records it in the in-app audit log (visible to participants of the competition via `/api/drill-instructor/message/` and to staff via Django admin).
- If browser push is enabled in the config, the same message is also dispatched to the athlete's subscribed devices.

### Built-in personas
Every persona has its own **profile picture, tagline and accent colour** - they show up across the Coach page, the chat-style coach feed, the bottom navigation and even as the icon of push notifications.

| Persona | Style |
| --- | --- |
| **Drill Sergeant** | Tough-love military barking. Roasts laggards, mocks the leader, rallies the platoon. Group spirit with bark. |
| **Roast Master** | Maximum roast mode - savage but affectionate, NBA-banter energy. Playful sarcasm, absurd comparisons, 1-2 emojis. Best for adult group chats that love trash talk. |
| **Cheerleader** | Endless enthusiasm, capital letters, emojis, always positive. |
| **British Butler** | Dry, polite, devastating one-liners. |
| **Zen Master** | Calm and philosophical, focused on inner balance. |

Competition owners can also create their own persona: pick one of the shipped avatar artworks (megaphone, rocket, ninja, robot, captain, ...) or a single emoji, choose an accent colour, and edit the system prompt.

### The Coach page (`/coach`)
The Drill Instructor is the heart of the app:
- **Hero card** - the persona currently on duty with its latest message in a speech bubble.
- **Coach wire** - a chat-style feed of every generated message across your competitions (persona avatar, athlete, workout summary, competition chip), live-refreshing.
- **The roster** - all personas as tappable cards with profile pictures and briefings.
- **Coach pings** - the platform-aware push opt-in (with the iOS "Add to Home Screen" flow built in).

### Using MiniMax as the LLM
The instructor uses any OpenAI-compatible chat-completions endpoint. To run it on **MiniMax**:
1. Get an API token from the MiniMax dashboard.
2. In **Site Settings → LLM / AI Provider** pick the **MiniMax** preset. This auto-fills the base URL (`https://api.MiniMax.chat/v1`) and default model (`MiniMax-M3`). Paste your API key and save.
3. Or set env vars `LLM_PROVIDER=MiniMax`, `LLM_API_KEY=...` and restart workers.
4. The Drill Instructor and weekly email both flow through the same provider - swap once and both update.

### What the participant sees
Participants can read every generated message from the audit log at `/api/drill-instructor/message/` (visible only for competitions they belong to). With browser push enabled, the instructor's message also shows up as a system / push notification on their subscribed devices.

### Removing it
Disable the toggle, or click **Remove Drill Instructor**. Generated messages remain in the audit log unless the owner deletes them.

## Admin & Site Settings
The first user to register is automatically promoted to **staff + superuser** so they can manage the site. Sign in as that user and you'll see an **Admin** link in the top navigation (with a shield icon).

The admin page (`/admin/site-settings`) - and the Django admin at `/admin/site_settings/sitesettings/1/change/` - edits three sections of runtime configuration. Resolution order is **database → environment variable** for every field, so changing values in the admin takes effect immediately without restarting workers.

**LLM / AI Provider** (used by the AI Drill Instructor and weekly email)
- API Key, Base URL, Drill Instructor Model (`gpt-4o-mini`), Weekly Email Model (`gpt-4o`).

**Strava** (used for OAuth link and daily activity sync)
- Client ID, Client Secret, Rate Limit / 15min (default 100), Rate Limit / Day (default 1000).

**SMTP / Outbound Email** (used for welcome, leaderboard, weekly, password reset emails)
- Host, Port, Username, Password, Use TLS, Use SSL, From Address, Reply-To (comma-separated).

All secrets (`llm_api_key`, `strava_client_secret`, `email_host_password`) are write-only on the API - only a masked preview is returned.

To promote another user to admin:
```bash
docker compose exec workoutchallenge python manage.py promotetostaff user@example.com
```

## Mobile / PWA & Push Notifications
The app ships as a Progressive Web App with a dark, athletic "volt" design language:
- **Installable** - on iOS Safari tap the Share button → "Add to Home Screen"; on Android Chrome you'll get an automatic install banner. PNG home-screen icons (incl. maskable) plus a monochrome Android notification badge ship in `public/`.
- **Offline shell** - a service worker (`public/sw.js`) caches the app shell, fonts, persona avatars, last-viewed pages and icons so the app opens even without a network. Custom `offline.html` shows a friendly fallback.
- **Standalone display** - no browser chrome when launched from the home screen.
- **Safe-area handling** - iPhone notch / Dynamic Island / home indicator respected on the bottom nav and modals via `env(safe-area-inset-*)`.
- **Mobile bottom nav with the Coach at centre stage** - a thumb-friendly dark tab bar (Home, Compete, **Coach**, Log, Me/Admin). The centre button carries the profile picture of the persona currently on duty and opens the **Coach page** (`/coach`).
- **Light / dark themes** - class-based theming with a manual toggle in the top navigation (follows the OS by default, choice is persisted).
- **Self-hosted fonts** - Inter (UI) and Archivo Black (display) ship in `public/fonts/` so the PWA works fully offline.
- **Touch targets** - all icon-only buttons hit the iOS / Android minimum of 44×44 px.
- **Mobile-keyboard hints** - numeric fields get `inputMode="decimal"` / `"numeric"` so phones show the right keyboard.
- **Lazy-loaded pages** - `MySpace`, `Competition`, `Coach` and `AdminSettings` are split into separate chunks; the initial bundle stays small on first paint.

### Browser push notifications
You can opt in to browser/system notifications so the AI Drill Instructor pings your device whenever it comments on a workout in a competition you've enabled push for - the notification even carries the persona's profile picture as its icon.

Setup:
1. **Install the app** to your home screen (required on iOS 16.4+; optional elsewhere).
2. Open the app → **Coach page → "Enable coach pings"** (or **Admin → Site Settings → Browser Push Notifications**). The Coach page walks iOS users through the Add-to-Home-Screen requirement automatically.
3. For each competition where you want push, click **AI Drill Instructor → "Browser push for participants"** on the competition page.

The server uses **VAPID** to sign notifications:
- The keypair is generated automatically on first start and persisted at `DATA_DIR/vapid.json`. **Don't lose this file** - changing it invalidates every existing subscription.
- For production, generate a stable keypair once with `py_vapid` and pin it via `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars (`VAPID_SUBJECT` is the `mailto:` contact, default `mailto:admin@example.com`).

To update the service worker version (forces all clients to re-fetch the shell after a release):
```bash
# Edit public/sw.js and bump CACHE_VERSION, then rebuild.
docker compose build
```

### How to get the Strava API Client id & secret
1. Login to your Strava account [strava.com/login](https://www.strava.com/login)
2. Profile picture -> Settings
3. "My API Application"
4. Test the workout challenge (only works with your own Strava account)
5. If you like the workout challenge, apply to the [Strava developer program](https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8) here to also allow other users to link their Strava

## Do you want to help / contribute?
### Code Overview / Structure
- [**Docker Container**](/Dockerfile) for deployment 
- [**Supervisord**](supervisord.conf) to start all processes in docker container
- [**Nginx**](/nginx.conf) to run frontend (React) and proxy traffic to backend (Django) which is run by gunicorn
#### Frontend *([src-frontend](/src-frontend))*
- [**React**](/src-frontend/src/App.js)
#### Backend *([src-backend](/src-backend))*
- [**Django**](/src-backend/workout_challenge/settings.py) (RestAPI) via gunicorn for production
- [**Redis**](supervisord.conf) as cache and for Celery
- [**Celery**](/src-backend/workout_challenge/celery.py) as task que for Django
- [**Celery Beat**](supervisord.conf) for task scheduling for Django
- [**Celery Flower**](supervisord.conf) UI to inspect task que and task status
- [**mjml**](src-backend/custom_user/templates) Framework / app to write responsive email html ([mjml.io](https://mjml.io))

### How to run locally for development
#### Backend - Task-Scheduling (Celery)
working dir: `/workout_challenge/src-backend`  
run Redis: `redis-server`  
run Celery Worker: `celery -A workout_challenge worker --loglevel INFO --without-mingle --without-gossip --events`  
run Celery Beat: `celery -A workout_challenge beat --scheduler django_celery_beat.schedulers:DatabaseScheduler --loglevel INFO`  
run Celery Flower: `celery -A workout_challenge flower`  
***Note:** For testing email celery tasks, please set the Email env variables. For testing Strava sync celery tasks, please set the Strava env variables. For celery beat, don't forget to set the timezone env variable.*

#### Backend - RESTApi Server (Django)
working dir: `/workout_challenge/src-backend`  
suggested env variables:
```
PYTHONUNBUFFERED=1
DJANGO_SETTINGS_MODULE=workout_challenge.settings
DEBUG=true
MAIN_HOST=http://localhost
HOSTS=http://localhost,http://127.0.0.1
TIME_ZONE=Europe/London
STRAVA_CLIENT_ID=000000
STRAVA_CLIENT_SECRET=<secret_key>
```
initial Django setup: `python manage.py makemigrations && python manage.py migrate`  
run Django: `python manage.py runserver`  

#### Frontend (React)
working dir: `/workout_challenge/src-frontend`  
suggested env variables:
```
REACT_APP_BACKEND_URL=http://localhost:8000
```
run React: `npm start`


#### ToDos / Ideas:
- Add help text to "Link Strava Button" if Strava linkage is not set up
- Add explanation text for how Steps are converted
- Add tickbox for runs/walks if they count towards the total daily steps
- Group finished competitions in archive button
- Remove total daily steps from weekly email
- Add competition finish email
- Send competition start email if user joins after competition already started
- Add help text if users try joining competitions using non-invite link
- Add option for competition admin to remove users
- Improve README texts
- Improve repo link preview picture
- Add Futbit API suport
- Add friends page
- Add more personal statistics
- Add medals and achievements
- Add UI hint if old version of workout challenge is used
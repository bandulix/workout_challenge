# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Outdated Android APKs only show the download.** If the installed build is older than the APK the server is publishing (`/download/apk-version.json`), the app does not load — just *Download update* (install over the top keeps login). Applies from this APK onward; earlier builds still have the dismissible Home banner until they update once.

### Security
- **Site Settings secrets and the VAPID private key are encrypted at rest.** LLM API key, Strava client secret, SMTP password, and Health developer password are Fernet-encrypted in Postgres (same key material as Garmin/Strava OAuth tokens). Auto-written `data/vapid.json` stores an encrypted private key (`0600`). Prefer pinning `VAPID_*` via env in production. After upgrading from plaintext storage, **rotate** any secrets that lived in old DB dumps or volume backups — see [docs/security-secrets-and-backups.md](docs/security-secrets-and-backups.md). (#29)
- **Default bind is loopback.** `APP_BIND` defaults to `127.0.0.1` — put a TLS-terminating reverse proxy in front. Set `APP_BIND=0.0.0.0` only on a trusted LAN. Garmin/Strava link routes refuse cleartext HTTP unless `DEBUG` is on. (#30)
- **Flower / Open Wearables admin / Health developer passwords must differ from `SECRET_KEY`.** Compose requires `FLOWER_PASSWORD` (and `OW_ADMIN_PASSWORD` with `--profile health`); production Django refuses to boot if they match. (#30)
- **Release APK builds fail without real signing.** No silent debug-keystore fallback for `assembleRelease` — use `~/.gradle/workout-signing.properties` or `ANDROID_KEYSTORE_*` secrets. (#30)

### Changed
- **⚠️ BREAKING — web refresh tokens are httpOnly cookies only.** The browser no longer keeps a refresh JWT in JS storage; JSON login/refresh responses omit `refresh` unless the client sends `X-WC-Client: native` (Android APK). After this deploy, **web users may need to sign in again** once. The service worker never caches `/api/` (network-only), so stale auth responses cannot stick in the SW cache. (#33, supersedes #31)
- **APK update check no longer hides a same-day release.** A passing check still skips the *Checking for an update* splash, but the app re-fetches `/download/apk-version.json` on every start, resume, and every 15 minutes. If the server published a newer APK, the download screen appears immediately. (The old 24h cache skipped the *network*, so an install that opened the app this morning never saw this afternoon's APK.)
- **What's new on the Android app offers Download update**, not Reload (Reload cannot replace a bundled APK).
- **Photo roast keeps the coach's world, the coach's face, and the workout stats — and surprises on everything else.** Each roast picks a different look (photoreal photograph, movie still, graphic novel, oil painting, anime keyframe, night-rain, 1970s film, and more) plus a random camera and stats prop. Echo art stays the splashy movie-poster treatment. Self-added coaches still use their description as the world (stock artwork is only an icon); built-ins keep their named stages. Stats stay a physical object in the shot.
- **Coach face in a roast is the profile picture.** xAI multi-image edits now send the portrait as `images` (the old `image: [… ]` body 400'd and the retry dropped the face). Face-lock wording names `<IMAGE_1>`. If a portrait exists, we no longer retry without it.
- **Feed is the last 15 posts**, then Show more. The “last 10 plus every pictured workout” dump is gone. Photo replies sit behind the reply button again — they no longer open themselves.
- **Coach page no longer repeats your last workout** under the latest post. The on-duty card is only the newest line.
- **Dock coach glow and label use that coach’s accent**, not always volt.
- **Hall of Roasts, next-week’s vote, and Order of the Day** sit on the gym plate like the feed: hairline titles, independent glass cards (no wrapping pane, no gold frames). Your pick uses that coach’s accent ring.
- **Feed loads faster, especially in the APK.** The messages API is paginated (old clients that omit `limit` still get a list). Card pictures are 800px JPEGs with a private 24h cache and ETag; avatars are 256px. The Android app stores them on disk instead of re-downloading as base64. First paint uses the last 15 posts and no longer waits on the season points feed. Board/Trophies and Hall of Roasts mount when you open them. Polling only refreshes page 1. nginx gzips JSON. Challenge goal bars still count the whole day/week/month, not just the 15 visible posts. Tapping a card photo opens the original, not the 800px JPEG.
- **Closed registration no longer auto-promotes the first signup to admin.** Set `REGISTRATION_TOKEN` and use `createsuperuser` or `promotetostaff`. Open registration (token unset) still makes the first account the operator; two concurrent first signups can no longer both become superuser.
- **Home rank chips use a tiny summary** instead of the full season stats snapshot. Challenge Feed no longer polls the board payload. Latest workouts on Home show at most 40 rows.

### Fixed
- **Scrolling no longer drags the gym backdrop.** The Ken Burns zoom stays; the photo no longer pans up or recrops when the page (or the phone's URL bar) moves.
- **CrowdSec still 24h-banned iPhones opening the coach vote.** The ballot paints every coach portrait at once. Teammate-made coaches (and coaches with no file) answered `404` on `/api/drill-instructor/persona/<id>/picture/?size=avatar` — six distinct 404s is `http-probing`. Picture GETs that cannot send bytes now return `204`; nginx X-Accel misses do too. Teammates can load each other's custom coach faces. Same 204 for user / feed / Echo pictures with no file.
- **Old Android APKs never saw that an update was required.** `/download/apk-version.json` was served with `Content-Disposition: attachment` (meant for the APK file). The WebView download listener swallowed that fetch, so both the Home banner (pre-0.49) and the force-update screen (0.49+) failed open and the app loaded as usual. The JSON is now a normal CORS response; the APK file stays an attachment. New builds also read `/api/apk-version/` if the file is missing.
- **CrowdSec `http-probing` still 24h-banned a visit after the thumb chmod.** nginx is not the `app` user: original uploads (lightbox, failed thumbs) could stay `0600`, `thumbs/` could stay `0700`, and a missing file was nginx `404`. Six distinct `/picture/` 4xx in a couple of seconds is the ban. Picture GETs now chmod the file *and* parent dirs, chmod the tempfile before `replace` so dest is never `0600`, stream from Django if nginx still could not read, and answer `204` (not `404`) when the bytes are gone. The client treats `204` as no image and does not refetch 400/403/404 on every remount. Files stay private: `/media/` and `/protected-media/` 404 for the internet; bytes only go out through `/api/…/picture/` after a JWT.
- **Coach portraits missing in the APK.** The Android disk cache serves pictures as `https://localhost/_capacitor_file_/…`. User avatars and feed photos use that URL as-is; coach portraits ran it through `safeImageSrc`, which only allowed `blob:`, `data:image/`, and relative paths, so the face stayed empty. The whitelist now accepts Capacitor local-file URLs.
- **Swiping Feed → Board crashed until you tapped Board.** The gesture mounts Board while `?tab=` is still Feed, so the stats query stayed skipped and the leaderboard read `undefined`. Tapping the tab started the fetch (and then swipe worked from cache). The swipe now peeks stats during the drag and the board waits for the payload.
- **Avatar and card JPEGs 403'd in production** (`tempfile.mkstemp` writes `0600`; nginx is not the `app` user). Six distinct `/picture/?size=avatar` 403s in two seconds is CrowdSec `http-probing` — a 24h ban for opening the Android app. Thumbs are now `0644`, existing files are chmod'd on container start, and nginx is in group `app`.
- **Replies and stamps show up immediately** instead of sitting behind a stale 20s message list. They no longer rebuild the season points snapshot — that refreshes when a workout actually changes scores.
- **Card JPEGs no longer share one `.tmp.jpg`.** Each thumb writes its own tempfile and keeps at most 200 on disk.
- **Re-uploading a portrait busts the picture** in the browser and on the APK disk cache (ETag revalidation, not `force-cache`). Logout and a 401 also clear the native cache.
- **Login/join throttles are per client behind nginx**, not one global bucket that could lock the whole site.
- **Push subscriptions cannot point at an attacker URL.** Signup no longer says an email is already taken. Display names that collide get a suffix. Only a participant can take over a challenge. Workout kcal/km/steps have sanity caps. Coach error text is owner/staff only. APK downloads must match the configured server. `/download/` keeps security headers; join and OAuth codes are redacted in nginx access logs.

## [0.48.0] - 2026-08-28

### Added
- **Confirm your email before any other mail.** Signup sends a short confirmation link, not the welcome. Welcome, weekly, board, and “log your workouts” wait until that link is clicked. Existing accounts stay confirmed. Changing your address sends a new link. Resend is on the yellow bar (own inbox, 10-minute cooldown).
- **Photo on an activity is +10P** — one picture per workout. The original lands as a feed answer on the activity; the coach's remixed poster is the activity-card backdrop and the hot-or-not card. The Photo button advertises +10P and disappears after upload.
- **Tap the points chip** for how that score was made: real minutes / kcal / km, the activity-type factor from Site Settings, each challenge goal (target, period, caps), Photo +10P, and Order +5P. Several goals add up (`25 + 10 + 5 = 40P`). If a cap fired: “Capped at 40P. You hit the daily limit of 60 active minutes.”
- **Leaderboard shows equalizer factors** for every athlete (`92% effort · 105% distance`), including team rows and the athlete card.
- **Your stamp comes off only on the profile-pic button** — tapping the emoji itself no longer unstamps you (hover / long-press still shows who voted).
- **Challenge owners can delete an Echo** — small trash on the card. Wars and art files go with it; holder counts refresh.
- **Daily order is +5P** — completing it credits five points on that workout. The green Order tag reads `+5P`. The points-chip popup lists Order next to the goals and Photo +10P.
- **Stamps on activities** — 14 cartoon locker-room stickers (WTF!, GOAT, Oof, Too cool, Lit, …). Icons sit next to the points chip. Stamp (next to Reply) becomes your photo after you pick one; tap the photo to take it off. One stamp per person. Hover or long-press an icon for names.
- **Echo Chamber events in the feed** — planting, war, claim, and immortal already posted a coach line. Adding art and a held defense now do too; pictured Echoes show the art on that card.

### Changed
- **Feed keeps the last 10 posts**, then only workouts that have a picture. The old 48-hour dump and “N older” toggle are gone.
- **Coach portrait ring matches the roaster** — the neon ring, activity ticks, and orbiting pips use that coach’s accent colour instead of always volt.
- **Pulldowns match the glass UI** — sport type, intensity, gender, teams, goals, and site-settings provider use a frost list with volt for the current choice instead of the OS-native menu.
- **Echo Chamber art first** — trophies with a picture sit above crown placeholders (power still ranks inside each group).
- **Coach pings are quieter** — one random pep talk per day (was 1–2), and two events a few seconds apart (workout comment + Echo, overlapping beat jobs, a late catch-up) collapse to a single lock-screen ping instead of buzzing twice.
- **Photo remix lives in the coach’s world** — the edit prompt reads the persona description as the setting (place, props, lighting), not a generic gym. Workout stats are baked into that world (TV, wall picture, tattoo, chalkboard, …), not a floating HUD.
- **More sport types** — Muay Thai, Boxing, Kickboxing, Martial Arts, plus Strava’s newer ones (Basketball, Volleyball, Cricket, Padel, Dance, Physical Therapy). Garmin and Health Connect map onto the same list; unknown types still become Other Workout.
- **Echo Chamber groups close sports** — road / gravel / mountain / indoor bikes share one Cycling trophy (e-bikes stay separate). Same idea for run variants, rowing, walk/snowshoe, combat, and ski. A gravel ride can claim a road-bike Echo.
- **Popups are glass sheets** — same frost as the dock, rounded and inset so the gym plate shows around them. The close X sits below the iOS PWA status menu (`safe-area` plus a little extra). Closing a popup restores the scroll position instead of jumping to the top.
- **All outbound mail matches the app** — ink canvas, volt buttons, “Your AI Drill Instructor” wordmark, fork source link. No leftover teal hero or upstream GitHub URL.
- **Dark theme only** — light mode, Match device, and the Settings theme cycle are gone. Night backdrops only; limestone (`-light`) plates removed.
- **Coach On duty shows the latest line and your last workout.** If the newest post is already yours, it is not duplicated. Same activity card as the feed (points chip, photo, backdrop).
- **Feed cards** — on-duty strip, one glass card per event, coach quote under the athlete, day hairlines. Board and Trophies use the same cards (no wrapping pane).
- **“How Points Work”** in the challenge header is gone; the chip popup replaced it.

### Fixed
- **Android app serving stale data** — Capacitor now follows the usual hybrid-app cache rules: no service worker inside the APK (it fought updates), WebView HTTP cache off for API GETs, live queries always revalidate on open / resume / reconnect (last snapshot still paints instantly), and app resume uses the native App plugin because the WebView often skips `visibilitychange`.
- **Activity photo used the original everywhere** — the upload is the feed answer; the AI-edited roast is the activity backdrop and the hot-or-not / Hall of Roasts card.
- **CI persona tests (404 vs 403)** — listing assigned custom coaches used a JOIN that hid built-in personas on PATCH/DELETE. Stock coaches 403 again; someone else’s custom coach stays 404.
- **Feed points leaked other competitions** — the chip summed every `Points` row on the workout. It now matches the Board (this challenge’s goals and awards only).
- **Goal editors showed `130.00`** which `type=number` rejected on save. Values display without trailing zeros.
- **APK cold start** landed on `/` with an empty cache. Last screen and a sanitized API snapshot restore immediately.
- **Uploaded images cannot be fetched as public files** — nginx already 404s `/media/`; Django now 404s it too. Custom coach portraits are only visible to the creator, staff, and people in a challenge that uses that coach. Picture responses stay `private, no-store` / `noindex`.

### Removed
- Light-theme selector, system theme matching, and the ten `-light` backdrop files.

## [0.45.0] - 2026-08-25

### Added
- **Daily action backdrops** — five volt-neon plates (snowboard, swim, gravel, studio, lift) rotate one per local calendar day. Dark mode and login use the night grade; light mode uses a brighter twin. The old gym-runners still is gone.
- **Coach 24h activity ring** — neon-green volt ring on the persona portrait, segmented by who trained in the last 24 hours (full/glowing vs sparse). Mood-based orbiting pips stay around it.
- **Coach message wheel** — last five coach lines in the hero bubble, with up/down and drag.
- **Overlay portal** — popups (roasts, info, athlete cards, forms) render on `document.body` so glass `backdrop-filter` no longer traps `position:fixed`.
- **Native camera vs gallery** — Android `takePhoto` / `chooseFromGallery` (FileProvider Pictures path). Web keeps a labelled capture input.

### Changed
- **Light mode glass** — limestone canvas (`#efece4`), white frost over the plate, darker secondary type and volt labels. Dark charcoal glass is unchanged. Dock sheen runs in both themes (quieter on dark).
- **Theme first launch is Match device** — `color-scheme: light dark` until the user picks Light or Dark. Android WebView follows the system night setting.
- **Coach is the default landing** (`/coach`). Challenge goals pull-down, quieter tabs, 48h feed, replies only on activity posts.
- **Create a challenge** from the Compete dock actually opens the challenge form.
- **Ken Burns plate** on every screen, including after login.
- **Popups** share one glass size/shape. Roaster cards sit in a multi-column grid. AI Drill Instructor settings use the same glass chrome.
- **Android status / WebView canvas** uses limestone in light and ink in night.

### Fixed
- **Popup freeze** when closing X / info / hall of roasts / activity rows — overlays were clipped inside frosted cards.
- **Login dock** no longer shows on `/login/` (trailing slash) or when logged out.
- **Camera button opened the gallery** on Android because FileProvider missed `Pictures/` and HTML `capture` was ignored.
- **Coach portrait animation** missing after the five-style experiment — mood orbit is back, with one calm default when there is no mood yet.

## [0.44.0] - 2026-08-24

### Added
- **Home latest workouts has “N older activities”** — same day-grouped history sheet as the challenge feed, instead of only the last 5.
- **Challenge opens on Feed** and swipes to Board and Trophies. The tab bar has chevrons, a sliding pill, and page dots so it reads as swipeable.
- **Echo art reminder** — if you hold an Echo without a picture, a popup asks you to add one (Camera or Gallery). Later dismisses that Echo until you upload.
- **Coach comments when someone declares war on an Echo** — persona-voiced announcement in Coach’s Corner (canned fallback if the LLM is down), labelled “Declared war”.
- **Public athlete card** — tap a leaderboard avatar for rank, week and trend, workout KPIs, dog tags and Echoes. No email or legal name.

### Changed
- **Challenge tabs are Feed / Board / Trophies** (Feed first).
- **Hall of Roasts is on the Coach page**, not on the challenge Trophies tab. The box shows the top 3; a “N more roasts” button opens the rest.
- **Dog tags are only on Home** (welcome box) and the Settings sheet — the extra Coach box is gone. Tapping a tag opens a short description of the achievement.
- **Light mode contrast** — leftover night-ink cards (coach hero, streak, pings, Echoes, orders, dog tags) now have light surfaces; borders and body text are darker on the olive canvas. Theme still defaults to the device setting; Settings cycles Match device → Light → Dark.
- **Gym photo behind the whole app** — login’s night plate in dark mode, a daylight twin of the same scene in light mode. Cards, modals and the dock are frosted glass over it. Primary actions stay solid volt; secondary buttons are glass pills.
- **Vote next week’s coach is on the Coach page** (below Hall of Roasts), not on the challenge Board. If you are in more than one coached challenge, a chip row picks which ballot you are voting on.
- **Coach’s Corner is the feed** — when the coach comments on a workout, the post shows the athlete’s picture, workout line, order ribbon and points. The separate Activity feed box is gone.
- **Leaderboard carries the week and the trend** — each row has a 7-day spark of that athlete; your row also shows this week’s bars and a cumulative spark vs the field. The separate This week and Trend boxes are gone.
- **Activity goals sit in the challenge info box** — slim progress rows for your targets, with Edit for the organizer. The extra Activity goals box on the Board is gone.
- **Configure is gone from Coach’s Corner** — owners still set up the coach from the challenge header.
- **The roaster lives under Settings**, not on the Coach page. Same create / manage / detail flow, opened from the Settings sheet.
- **Bottom nav “Me” is now Settings** — Account opens personal details and device links.
- **Settings and Compete grow out of the dock** — they pull up as the same glass capsule as the menu bar, not a separate sheet. Tap the tab again (or the dimmed canvas) to close.
- **Account is grouped** — Profile, Emails, Connected services (Strava / Garmin / Health), then save. Title is “Account”, not “Personal Setting”. Goal Equalizer, Help, and admin settings use the same type, cards and field chrome.
- **Dock is frostier** — stronger backdrop blur and a more opaque fill so page content does not show through. The active tab is a slim volt dash under the label instead of a green chip.
- **Coach “who moved” is an orbit** around the persona portrait. Lit hopping pips are athletes who trained; the caption reads “N of M trained last 48h”. Mood (Unleashed / Proud / …) is a chip next to On duty — the extra “coach is unleashed” line under the last message is gone.
- **Coach “Open the feed” is “Add a photo”** and only appears when the speech bubble is the coach commenting on *your* workout.
- **Coach’s Corner reply row** — camera, comment field and send sit on one 44px row. Picture replies show a live elapsed timer. A “N older messages” button expands the box past the latest 3.
- **Weekly coach vote stays after you pick** — the Coach-page ballot keeps showing tallies and your highlighted pick; tap another coach to change your vote until Monday.
- **Tied weekly coach votes are drawn at random** — previously a tie (including the sitting coach) always kept the incumbent, which looked like the vote never switched. No votes still keeps the current coach.
- **Echo art is splashier** — the remix now puts the holder and the coach together in an invented, persona-styled world (movie-poster energy, not a snapshot). Workout stats stay on the picture; the coach portrait is used as a face lock when there is one.
- **README screenshots recaptured** for the gym-glass UI (login, Home, Feed, Coach, and the social preview).

### Fixed
- **Echo art can only be set by the current holder** — staff used to get the camera button on every Echo and the API accepted their upload. Admins who do not hold the Echo no longer can.
- **Google Health Connect still not importing, and Re-Sync bringing in nothing** — tapping Sync only *scheduled* WorkManager, then the server polled Open Wearables immediately (still empty) and stamped `health_last_synced_at`, which locked both the hourly beat and the button for ~an hour. Re-Sync now waits for an in-process `syncNow()` upload, retries the OW list while ingest is queued, and the manual cooldown is 2 minutes. The Android plugin also pins the Google provider (the SDK worker defaulted to Samsung), calls the SDK foreground/background lifecycle hooks, and requests notification permission so the health foreground service can actually run.
- **Challenge tab bar `role="tablist"` was outside the tag** and leaked as text; swipe tabs now expose a real tablist.
- **Edit-photo affordance is hover-only** — the volt camera bubble is gone from Home, Settings, persona edit, and Echo art. Hover (or tap) the picture to change it.
- **Hot or Not is hidden** when there are no unrated roast pictures left to vote on.
- **Android status-bar strip** — the thin black band above the page was the splash/window color showing through the status-bar inset. The window, WebView and that inset now use the olive (or night) canvas, with a transparent status bar so the background reaches the top.
- **Echo art daily cap is atomic** (`cache.incr`); remix is skipped if the Echo changed hands after upload. Health Re-Sync stamps under a row lock so overlapping GETs cannot skip the 2-minute cooldown. Native Health Connect `daysBack` is clamped to 1–43.
- **A teammate could edit or delete another athlete’s account** — `GET/PATCH/DELETE /api/user/<id>/` skipped object permissions, so anyone in the same challenge could change a co-participant’s email, password or wipe the row. Object GET/PATCH/DELETE is now self-only; avatars of teammates still load. The public card uses the stats payload, not this endpoint.
- **Health identity was writable on the profile** — `health_user_id` and `health_last_synced_at` could be PATCHed, which would attach someone else’s Open Wearables user or skip the sync cooldown. Both are read-only; only the Health link/sync views write them.
- **Health host URLs reject credentials and non-http(s)** in Site Settings, the Android `HealthHost` check, and the WebView fetch path. A poisoned `localStorage` host is dropped when the server-provided public URL has a different origin.

## [0.42.0] - 2026-08-23

### Added
- **Echo Chamber art upload** — the current holder can add a photo on the Echo card (camera or gallery). The coach remixes it to match the Echo title and sport; the original stays if no image-edit model is configured.
- **Echo holder crown on avatars** — anyone holding a living or immortal Echo gets a small volt crown on their profile picture (Home, Me sheet, leaderboard).
- **Get started checklist on Home** — join/create a challenge, connect a device or log by hand, turn the coach on (owners). Hides when it's done.
- **HEIC/HEIF photos** from iPhone and Galaxy camera rolls (Pillow + `pillow-heif`, re-encoded to JPEG).

### Changed
- **Compete opens your running challenge** when you only have one; the picker appears when you have several.
- **Challenge page is Board / Feed / Trophies** instead of one long scroll. Coach conversation lives on Feed; Echoes and Hall of Roasts on Trophies.
- **Coach tab is the persona** (mood, roaster, pings). “Open the feed” goes to that challenge’s Feed.
- **Home is you** — the extra “My challenges” list is gone from Coach; Home still lists your challenges with your rank.
- **Wording is “challenge”** in the UI (join, create, invite, leave).
- **Apple-glass menu bar** — floating frosted capsule dock; Me/Compete sheets use the same material. Honours `prefers-reduced-motion`.
- **Dark mode is night charcoal, not olive** (`#0b0b0c` / `#141416`).
- **Garmin/Health hourly and manual sync look back 14 days** (was 3). First Health Connect catch-up on the phone is 43 days, matching Garmin’s initial import.

### Fixed
- **A broken Strava activity no longer blocks the rest of that user's import**; `elapsed_time` is used when `moving_time` is absent.
- **LLM roast-image URL fetch is SSRF-safe** (https, public DNS, redirect re-check, streamed size cap).
- **ALLOWED_HOSTS** uses hostname only (no `:port` from `HOSTS`).
- **Register throttle ignores spoofed `X-Forwarded-For`** unless the TCP peer is loopback nginx.
- **Celery task-status no longer echoes exception text**.
- **Logging a workout now refreshes the board and feed** (RTK `tagTypes` for Stats/Feed).
- **Leaderboard highlights you before you have logged** (`id` vs `workout__user__id`).
- **Activate the coach on a phone** no longer clips Create; Activate starts with Enabled on.
- **Android camera vs gallery** actually open the camera vs the library; HEIC/empty MIME is accepted and re-encoded to JPEG.
- **Profile picture on Android** uses the native camera/gallery prompt.

## [0.41.1] - 2026-08-23

### Fixed
- **CrowdSec `nginx-req-limit-exceeded` 24h-bans on a normal visit** — the service worker `cache.addAll()`'d 25 shell URLs in parallel on every install/update. Install now only precaches `/` + `/offline.html`. If you rate-limit a reverse proxy in front, allow about 25 r/s with burst 80.

## [0.40.0] - 2026-08-22

### Added
- **Legend Echoes** — standout workouts (relative PB, clutch overtake, mythic size, or the first flag of a challenge) are minted as living, claimable trophies in the Echo Chamber: remixed photo (when a Hall of Roasts poster exists), coach-voiced narrative, and a power rating. Undefeated Echoes sit on the challenge page and the coach keeps referencing them. Anyone in the group can declare war (7-day window, one active challenge per Echo); beating the metric claims the Echo, raises the bar to the new feat, grows the lineage, and the originator keeps Legacy status. Three failed claims — or the end of the competition — makes it Immortal and awards the Echo Immortal dog tag (claimants earn Echo Slayer). Season chronicle: Book of Echoes.

### Fixed
- **Login spinner never giving way to the app** — visiting `/login` deleted the access token and waited on a refresh with no timeout, so a slow or hung `/token/refresh/` left people on the loading bar; a 5s `localStorage` wait after password login threw uncaught and froze the spinner for good. The form now keeps a still-valid access token, caps silent refresh at 8s, always clears the loader, and a stale in-flight refresh can no longer wipe the tokens from a login that just finished.
- **Echo claims now move the bar** — a successful claim updates the Echo's metric, power and title to the winner's workout (the next challenger has to beat *that*), and a claiming workout cannot also plant a fresh Echo. Immortal Echoes close any open wars so they cannot be stolen after the season ends.
- **Echo wars cannot be won with a backdated import**, lapsed windows unlock on the next action (not only at 21:20), and a hung token refresh can no longer overwrite a login that just finished.

## [0.39.0] - 2026-08-22

### Added
- **Weekly coach vote in each challenge** — participants pick next week's Drill Instructor from the ballot (built-ins plus roasters created by people in that challenge). Votes tally Monday 07:15; the winner takes the megaphone, a handover line lands in Coach's Corner, and a live countdown shows how long they are on the clock. You can change your vote until the switch.
- **Anyone can create their own roaster** — custom Drill Instructor personas are no longer admin-only. Staff can add, edit and delete every roaster (including built-ins and other people's). Everyone else can only create, edit and delete the ones they made.

### Changed
- **The roaster sits above coach pings** on the Coach page, with a Create yours card and a Manage button for every user.
- **Hall of Roasts lives on the challenge page** — it is per-competition (top remixed photos of that challenge), not a global box on the Coach page.
- **Challenge activity feed shows the latest 5** — older workouts open in a day-grouped history sheet ("N older activities") instead of stretching the box.
- **Hot-or-not: one rating per picture per user** — a second swipe on the same roast is refused (409); already-rated cards drop out of the selection stack (the "judge them all again" replay is gone). Hall of Roasts still shows every card.

### Fixed
- **Health Connect workouts not importing on their own** — several breaks on the same path: the Android SDK only restores background sync after `configure(host)`, which ran solely at link time, so a process kill stopped Health Connect pushing to Open Wearables; launch restore now re-configures and always re-arms WorkManager (a stale `syncActive` flag used to skip the restart). The Celery worker never imported `custom_user.health` (autodiscover only loads `tasks.py`), so the hourly poll was unregistered even when the PeriodicTask row existed; `custom_user/tasks.py` now loads it, and the `health_sync` beat job is re-seeded if it was missing. The mapper also accepts Open Wearables' `start_datetime` / `end_datetime` aliases and follows nested `pagination.next_cursor`.

## [0.38.1] - 2026-08-22

### Fixed
- **Desktop menu bar sat on the centre-left** — `animate-nav-rise` uses `transform`, which overrode `md:-translate-x-1/2`, so the dock's left edge was at 50% of the viewport. The pill is now `md:mx-auto` inside a full-width wrapper.
- **Profile pictures 406'd** — avatar fetches sent `Accept: image/*`, which DRF's JSON renderer does not match, so every `/api/user/<id>/picture/` (and persona/photo-post pictures) returned Not Acceptable. The client no longer sends that Accept, and the picture endpoints accept any `Accept`.

## [0.38.0] - 2026-08-22

### Added
- **Coach arcade** — Order of the Day (morning sealed mission, ribbon on the feed, evening sigh at slackers), Dunce megaphone on last place until they log, Hall of Roasts (top 3 remixed photos of the running challenge), Coach mood (Proud / Watching / Disappointed / Unleashed from the last 48h), and permanent dog tags (First Blood, Ghost Killer, Photogenic, Never Missed Monday, Survived the Dunce).

### Changed
- **Nav, colour and motion actually show up** — the bottom bar is an ink dock with a volt hairline and glow; the active tab is a filled volt pill (not a grey icon tint); the coach face sits in a breathing lime halo. Light mode canvas is olive (`#dfe8c4`) instead of near-white, cards pick up a volt-tinted border, and dark pages get a lime wash at the top. The bar rises in, the login photo ken-burns, the coach ring breathes (honours `prefers-reduced-motion`).
- **Corporate mark is the volt lightning on ink everywhere** — favicon, PWA icons, Apple touch icon, Android launcher (was the Capacitor blue-X), adaptive icon background (was white/teal), and splash (was a white Capacitor logo). SVG favicons no longer show the old sky-blue trophy.
- **Login/welcome background is a new Imagine still** (night gym, volt neon) that stays on screen. The previous stock runner vanished after ~2s because a near-opaque ink overlay only applied once Tailwind loaded; the photo is now a real `<img>` with a light scrim, preloaded, and cached by the service worker.

### Fixed
- **Goal-edit rescore no longer flattens every activity to the same points** — changing a target/metric rewrote `points_raw` then left `points_capped` at that uncapped raw (or, after the 30s Celery throttle skipped the recap, applied daily/weekly caps in UTC day buckets and ISO week-without-year). Evening workouts on different local days shared one daily cap, so a whole-challenge recap slammed long activities into the same number. Raw scores are now recomputed per workout, caps are reapplied immediately in the site timezone, and week buckets include the ISO year. Already-flattened challenges: re-save the goal, or `python manage.py rescore_goals` (optionally `--competition ID`). Workouts that actually exceed the daily cap (default Exercise: 60 min) still tie at that cap — that is the cap, not this bug.
- **CrowdSec / fail2ban 401 bursts while using the app** — the access JWT lasted 5 minutes, then every poller *and* every avatar fetch hit `/api/` with a dead token at the same instant (8–20 × 401 in a second, which `http-auth-bf` / `http-generic-bf` treat as credential stuffing). The client now refreshes 60s before expiry (one shared `POST /token/refresh/`), picture fetches wait on that refresh and run at most 4 at a time, the Android OkHttp UA is no longer the default `okhttp/4.x`, the login screen no longer calls `GET /user/me/` unauthenticated, and the access token lifetime is 15 minutes.
- **Photos can only be attached to your own workout** — the camera used to post into the main coach feed or onto any thread. Pictures now always hang under your latest workout comment (the camera is on every thread, including posts that @-mention you); someone else's workout is never the parent.
- **Coach name no longer truncates on mobile**, and the challenge-page reply row (camera + input + send) stays on-screen instead of pushing the send button off the viewport.

## [0.37.0] - 2026-08-22

### Added
- **CI now runs the backend test suite before every release** — a new `test` job in `prod-deploy.yml` installs from the pinned lockfile and runs `manage.py test` on Python 3.12. Autotag / Docker / APK wait for it, so a red suite can no longer mint a GitHub Release. Open PRs run the same job (the workflow previously only fired on merge). The cap-math cases that lived as a `__main__` script in `point_recalc.py` are now Django tests, and `workouts` has an API test module (auth, isolation, duration/steps validators). Also: the empty `src-backend/__init__.py` is gone — unittest treated that folder as a package and imported the suite as `src-backend.competition.tests`, which crashed every app's models on `manage.py test`.
- **`site_settings` tests** for staff-only access, write-only secrets, and DB-over-env resolution.

### Changed
- **Visual pass so Home and Challenge match the Coach** — workout/competition lists are tappable cards (not tables); goal bars always show caps and use a volt fill; the activity feed is a timeline with profile pictures and tap-to-expand scoring; team rosters expand on tap; this-week chart leads with a points hero; empty states use the coach face; errors/loaders/modals/forms sit on ink + volt (no leftover bootstrap blue); What's New opens on three visual beats. README phone screenshots (and the social preview) recaptured to match.
- **Photo remix prompt is hardcoded** (the admin-editable Site Settings template is gone). A posted picture is edited into the coach's world (setting from the persona description), the coach appears in the scene with their profile-picture face locked when a portrait is uploaded, and the answered-to workout's stats are painted on the image.
- **Python dependencies are pinned** — `requirements.txt` is the abstract spec (Django 5.2 LTS; 4.2 extended support ended April 2026); `requirements.lock.txt` is the pip-compile lock. The Docker image and CI run Python 3.12.
- **Vite is 6.4.3** — patched 6.x (dev-server FS/WebSocket issues). Not the Dependabot jump to Vite 8, which is a separate major.
- **Releases are no longer minted on every merge to main** — push/PR only run the test job. Cut a release from Actions (`workflow_dispatch`) after tests pass.
- **Frontend build is Vite**, not CRA/CRACO. Same `build/` output for nginx and Capacitor; no inline runtime chunk (CSP unchanged).
- **Login/register/password-reset use the same RTK API client** as the rest of the app (`usersApi` + `authClient.js`).
- **Scoring is an explicit `score_workout` / `unscore_workout` call** (`Workout.save(score=True)` still delegates so imports and tests keep working).
- **Polling pauses while the tab is hidden**.
- **Native `window.confirm` / `window.alert` replaced** with an in-app dialog.
- **How-to copy is provider-neutral** (Strava / Garmin / Health Connect).
- **`print()` in scorer, syncs, emails, point recalc is now `logger`**.
- **Uploaded pictures are resized** (avatars ≤512px, coach photos ≤1600px) before save.
- **Joining a competition/team no longer re-saves the parent row** (m2m add already scores; the extra save re-ran competition-change plumbing).
- **Feed membership uses `exists()`** like stats, not a full user-id list, and skips a wasted Competition fetch on cache hits.
- **Token blacklist on delete/unlink is one `bulk_create`**, not one insert per outstanding token.
- **`?my=` workout/user filters actually mean "the current user"** (they compared pk to the user id, which hid real workouts).

### Security
- **APK update link is a hardcoded path on a sanitized http(s) origin** — the native server-address field no longer flows into `href` as raw DOM text (CodeQL `js/xss-through-dom`).
- **User list no longer exposes co-participants' last names** (emails, staff flags, Garmin/Health ids, equalizer factors were already stripped; first name stays for the transfer-ownership picker).
- **Activity goals and teams cannot be re-parented** onto another competition via PATCH.
- **X-Accel-Redirect paths reject `..` / absolute names** so a poisoned ImageField cannot point nginx outside MEDIA_ROOT.
- **Help accordion no longer uses `dangerouslySetInnerHTML`** (static copy is JSX).
- **Team join is on the `join` throttle** (was unthrottled join-code-adjacent).
- **Celery POST is allowlisted** — staff can only enqueue known operational tasks, not an arbitrary registered name.
- **Uploaded images are verified and re-encoded with Pillow** (pixels, not the client Content-Type).
- **Per-resource permission classes** replace duck-typed `IsOwnerOrReadOnly` on workouts, competitions, teams, and goals. Points stay read-only + authenticated.
- **Permissions-Policy allows `camera=(self)`** so photo posts (`<input capture>`) are not blocked.
- **Logout now actually wipes the session on shared devices** — the logout/login/register flows reset only 6 of the 12 RTK Query slices, and the store re-persisted itself into `localStorage.appState` ~2s after `localStorage.clear()`, so admin site settings, team rosters and other cached API data survived "logout" in the browser. All three flows now dispatch the store-wide `RESET_STORE`. Also: `/logout` added to the reauth guard's public paths (the bottom nav's still-subscribed `me` query 401'd mid-logout and redirected to `/login?redirect=/logout` - the next login navigated back to /logout and wiped the just-issued tokens, a login-logout loop); the native app's server address (`wc_server_url`) survives the wipe (its loss stranded the APK's registration and post-logout API calls); per-device user leftovers (`wc_equalizer_inputs`, coach ping baseline) are cleared on login/logout; `health_developer_password` added to both secret scrub lists (was missing from the Redux persistence scrub and the Sentry redaction).
- **Open Wearables developer login no longer internet-exposed** — the new `/health/` route proxies the whole OW API for the phone flow; the developer login endpoint (admin-equivalent for the OW instance) and the API docs/schema are now 404 through it. Phones never need them (tokens come from the single-use code redeem); our backend logs in via the internal URL.

### Fixed
- **Android Java/Kotlin quality** — Capacitor's placeholder tests still lived under `com.getcapacitor.myapp` and asserted `com.getcapacitor.app` (they would fail if CI ran them). Replaced with a real-package context test and host-allowlist unit tests. Also: `allowBackup` off (Health Connect tokens must not hit cloud backup), FileProvider limited to app cache instead of the whole external volume, Health plugin coroutines cancelled on destroy, and SDK errors logged instead of being forwarded into the WebView.
- **CodeQL alerts on the Coach photo preview, APK update link, and equalizer storage** — the preview `<img>` now draws a decoded bitmap (not a raw blob URL of the pick); the in-app update button always links the same-origin `/download/workout-challenge.apk` (the JSON-supplied URL is ignored, and `getServerUrl` was never imported so the href was `undefined/…`); the equalizer no longer writes gender to localStorage (it already lives on the profile).
- **Editing a challenge goal now rescores the whole challenge** — a target/metric change previously only enqueued a cap recalc on the old `points_raw`, so changing 150 min → 300 min left every workout at the old raw score. Raw points are recomputed for every workout in the challenge window, then caps are reapplied from day one.
- **Coach photo posts can come from the gallery, not only the camera** — `capture="user"` on the file input forced the camera on phones and hid the library. The composer now offers Camera and Gallery as separate actions (gallery is a file input with no `capture` attribute).
- **Switching the coach no longer rewrites every old post's picture** — the feed serialized `config.persona` live, so picking a new persona replaced avatars on historical bubbles. Each message now snapshots the persona that was on duty when it was written.
- **Health Connect 5 km runs showing up as ~2.x km** — when Open Wearables omitted `distance_meters` (common on Android), `Workout.save` invented a MET×duration estimate (easy-run MET 7.8 × 20 min ≈ 2.6 km). Imports no longer estimate distance; metres/km/pace are parsed from the OW payload, and a 5.0 that is already kilometres is not divided by 1000 again.
- **Health "Re-Sync" on the Android app now also nudges the phone** — the button only polled the server, so nothing new arrived until Health Connect had already been pushed. Tapping it now kicks native background sync first.
- **Protected pictures refuse indexing and shared-cache storage** — `robots.txt` now disallows `/api/`, `/media/` and `/protected-media/`; picture responses send `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` and `Cross-Origin-Resource-Policy: same-origin`. `/media/` stays 404 and `/protected-media/` stays nginx-`internal`.
- **Password-reset polish: real error messages and a working footer link** — the reset flow (login → "Forgot Password?" → email link → new password) existed end-to-end but had two visible defects: the reset email passed the raw reply-to *list* to the footer template (`mailto:['support@…']` / `mailto:None` - every other email passes a single address), and the frontend only read `parsedError.detail`, so the two most common failures - an invalid/expired reset link and a rejected weak password (both DRF `non_field_errors`) - surfaced as "Bad Request (400) - Unknown error". The email now gets a single reply-to address like its siblings, and both reset API helpers extract the first human-readable message (`detail` / `non_field_errors` / field errors). Nine new tests cover the flow: identical 200s for known/unknown addresses (no user enumeration), case-insensitive email lookup, bad uid/token rejection, weak-password rejection, session blacklist + token one-time use on reset, and the email task's content.
- **Coach-page photos never got the roast remix (and never reached hot-or-not)** — the Coach page's photo button always posts the picture as a reply to the coach's latest message, and the reply pipeline (`post_reply_reaction`) had no roast path at all: it posted the text reaction and ended, so no edited picture was ever generated and the hot-or-not box (which only lists coach reactions carrying an image) stayed empty. Photo replies now earn the same roast remix as thread-root photo posts; the roast hangs under the thread root so it renders in the thread.
- **Stale avatars after re-uploading a profile/persona picture** — the authenticated image loader cached blob URLs by (stable) URL forever, so a re-upload kept showing the old picture until a full reload. Uploads now invalidate the cache entry (and blob URLs are revoked on eviction). Also: a removed picture no longer keeps rendering its stale blob.
- **"What's new" popup never appeared in the Android app** — it fetched a relative `/api/version/`, which resolves to the WebView's own `https://localhost` origin instead of the server.
- **Challenge page error box showed "undefined /"** — the stats-error branch rendered the competition query's error fields.
- **Dashboard crash when a competition's stats query fails** — the row dereferenced `stats.competition` unguarded and the error boundary took down the whole page; it now renders a dash.
- **Team creation failure was silent and threw** — `result.data.id` was used without checking the mutation result.
- **Activity-goal form robustness** — cleared optional min/max fields no longer send `""` (DRF 400); error messages accumulate correctly (functional state updates, only the last one survived before); a retry after a partial save no longer duplicates the goals that were created on the first attempt (the form re-syncs from the server state).
- **Goal boxes and "How Points Work" now show the same numbers** — the info view scales kcal/kJ/km targets and limits by your personal equalizer factors, matching the challenge page (it showed raw values before).

### Performance
- **Capped-points recalculation is batched and race-free** — the recalc task selected every Points row's workout one query at a time (N+1 via the Scorer's per-row dereferences), wrote one full-row UPDATE per row, and deleted RecalcRequests created mid-run unprocessed (stale caps until the next coincidental re-trigger). Now: `select_related`, `bulk_update` (500-row batches), an id snapshot so mid-run requests survive, and one `in_bulk` goal fetch for all groups.
- **Scorer bulk paths batch their writes** — new workout / new goal / competition date changes / user joins / scaling-factor and sport-factor re-scores all wrote per-row INSERTs and re-read the sport factors per row; they now use `bulk_create`/`bulk_update`, hoisted factor maps, and `select_related`/`prefetch_related` (a 500-workout user joining a 3-goal challenge went from ~1500 sequential INSERTs to a handful of round trips). A start_date shortening only enqueues recalcs for (user, goal) pairs that actually lost points (was the full cartesian product).
- **Hourly syncs no longer churn caches for nothing** — re-saving an unchanged activity early-returns before the stats-cache bust + recalc enqueue (previously every known activity, per user, per hour, invalidated every challenge snapshot it touched). Garmin/Health syncs load only the fetched page's ids instead of the whole table's provider rows; Strava's redundant whole-table id set is gone (the per-page map already covers it, including the cross-account takeover guard).
- **Activity feed endpoint is cached per stats generation (30s TTL)** — it rescanned the competition's entire Points table twice per request, uncached, on every 60-90s poll; it now shares the stats generation key (permission check still runs first on every request).
- **Settings resolution cached for 60s** — Strava rate-limit checks, LLM config and OW connector config each hit the SiteSettings row on every call; now cached briefly and invalidated on save, so admin edits still apply without restart.
- **Stats tail: one query less** — owner `select_related` and `len(members)` instead of a second COUNT query.
- **Weekly/leaderboard emails: one task per user** — the scheduler joins produced one row per active competition, so users in N challenges got N duplicate emails; both queries now use `distinct()`.

### Added

- **"How Points Work" info view in every challenge** — a new info button in the challenge header opens the actual scoring math for THAT challenge: each goal with its target/period as a plain formula (`points = minutes ÷ target × 100 × activity factor`), its per-activity/day/week floors and caps, whether daily step totals count, the site-wide activity-type factors, and your personal equalizer factors (effort %/distance %) with a pointer to the goal equalizer.
- **Admins can tune the points calculation per activity type** — Admin Settings → "Points Calculation" opens an editor for site-wide multipliers per sport (e.g. Swim ×1.5, Walk ×0.8; 1.00 = neutral). Stored on the Site Settings row (`points_sport_factors`, new migration `site_settings/0005`), applied by the scorer on every scored workout (60s-cached), and saving re-scores all affected existing points rows + enqueues the cap recalc automatically. Read back for everyone via `GET /api/points-factors/` (powers the info view above).

### Fixed
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

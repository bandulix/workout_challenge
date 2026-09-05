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

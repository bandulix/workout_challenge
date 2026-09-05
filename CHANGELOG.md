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

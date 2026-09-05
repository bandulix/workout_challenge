#!/bin/bash
# Build the Workout Challenge Android APK.
#
# Two supported shapes:
#   - per-deployment (MAIN_HOST set in .env): the server address is
#     baked in as the pre-filled default - the phone just confirms it.
#   - generic (MAIN_HOST unset): one apk works on every instance; the
#     app asks for the server address once on first start (an APK
#     cannot know where it was downloaded from).
#
# Prerequisites (once per build machine):
#   - JDK 21 (e.g. ~/jdk21) and Android SDK platform-36 (e.g. ~/Android/Sdk)
#   - npm ci already run in src-frontend (Capacitor deps included)
#   - required for release: ~/.gradle/workout-signing.properties
#     (assembleRelease fails without a real release keystore - no
#     silent debug-key fallback)
#
# Usage:
#   scripts/build_apk.sh            # release APK (requires signing props)
#   scripts/build_apk.sh --debug    # debug APK (faster, debug key)
set -euo pipefail
cd "$(dirname "$0")/.."

# --- server address from the deployment's .env -------------------------
if [ ! -f .env ]; then
    echo "ERROR: .env not found - copy .env.example first." >&2
    exit 1
fi
MAIN_HOST="$(grep -E '^MAIN_HOST=' .env | tail -1 | cut -d= -f2-)"
if [ -z "$MAIN_HOST" ]; then
    echo "NOTE: MAIN_HOST is not set in .env - building a GENERIC apk."
    echo "      The app will ask for the server address once on first start."
fi
# MAIN_HOST must allow the app's own origin (CORS with credentials):
# make sure HOSTS in .env contains https://localhost.
if ! grep -E '^HOSTS=' .env | grep -q 'https://localhost'; then
    echo "WARNING: HOSTS in .env does not include https://localhost -" >&2
    echo "         the app's API calls will be CORS-blocked. Add it." >&2
fi

echo "Building APK for backend: $MAIN_HOST"

# --- web build + capacitor sync ---------------------------------------
cd src-frontend
REACT_APP_BACKEND_URL="$MAIN_HOST" INLINE_RUNTIME_CHUNK=false npm run build
npx cap sync android

# --- gradle ------------------------------------------------------------
JAVA_BIN=""
for candidate in "$HOME/jdk21/bin/java" "$HOME/jdk17/bin/java"; do
    if [ -x "$candidate" ]; then JAVA_BIN="$candidate"; break; fi
done
if [ -n "$JAVA_BIN" ]; then
    export JAVA_HOME="$(dirname "$(dirname "$JAVA_BIN")")"
fi

# --- version stamping (drives Android updates + the force-update screen) ----
# versionName: latest git tag (e.g. 0.9.1) or "dev" outside a checkout.
# versionCode: commit count - monotonic, so every later build updates.
VERSION_NAME="$(git describe --tags --abbrev=0 2>/dev/null || echo dev)"
VERSION_CODE="$(git rev-list --count HEAD 2>/dev/null || echo 1)"
echo "Stamping version: $VERSION_NAME ($VERSION_CODE)"

# Uncommitted changes do NOT move the version code: the rebuilt APK would
# carry the same stamp as the previous release and installed apps would
# not see this build as an update (latestCode > installedCode).
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "WARNING: working tree has uncommitted changes - versionCode stays"
    echo "         at $VERSION_CODE, so installed apps will NOT see this build"
    echo "         as an update. Commit first if this build should ship."
fi

cd android
if [ "${1:-}" = "--debug" ]; then
    ./gradlew assembleDebug --no-daemon -PversionName="$VERSION_NAME" -PversionCode="$VERSION_CODE"
    APK="app/build/outputs/apk/debug/app-debug.apk"
else
    SIGNING_PROPS="${HOME}/.gradle/workout-signing.properties"
    if [ ! -f "$SIGNING_PROPS" ]; then
        echo "ERROR: release signing required at $SIGNING_PROPS" >&2
        echo "       (storeFile/storePassword/keyAlias/keyPassword)." >&2
        echo "       Use --debug for a debug-signed APK, or configure release signing." >&2
        exit 1
    fi
    ./gradlew assembleRelease --no-daemon -PversionName="$VERSION_NAME" -PversionCode="$VERSION_CODE"
    APK="app/build/outputs/apk/release/app-release.apk"
fi

echo
echo "APK ready: src-frontend/android/$APK"

# --- publish onto the stack (download link in Settings works) ---------
# nginx serves /download/workout-challenge.apk from this volume-backed
# dir; docker compose cp needs no host root and survives recreations.
if docker compose -f ../../docker-compose.yml ps --status running 2>/dev/null | grep -q workoutchallenge; then
    docker compose -f ../../docker-compose.yml exec -T workoutchallenge \
        sh -c 'mkdir -p /workout_challenge/src-backend/data/downloads'
    docker compose -f ../../docker-compose.yml cp "$APK" \
        workoutchallenge:/workout_challenge/src-backend/data/downloads/workout-challenge.apk
    # Version manifest for the in-app update check.
    TMP_JSON="$(mktemp)"
    printf '{"versionName":"%s","versionCode":%s,"url":"/download/workout-challenge.apk"}\n' \
        "$VERSION_NAME" "$VERSION_CODE" > "$TMP_JSON"
    # mktemp files are 0600 - nginx (different user) must be able to read it.
    chmod 644 "$TMP_JSON"
    docker compose -f ../../docker-compose.yml cp "$TMP_JSON" \
        workoutchallenge:/workout_challenge/src-backend/data/downloads/apk-version.json
    rm -f "$TMP_JSON"
    echo "Published on the stack: /download/workout-challenge.apk (+ apk-version.json)"
else
    echo "NOTE: stack not running - skipped publishing. Copy the apk onto"
    echo "      the server later, e.g.:"
    echo "      docker compose cp src-frontend/android/$APK workoutchallenge:/workout_challenge/src-backend/data/downloads/workout-challenge.apk"
fi

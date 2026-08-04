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
#   - optional: ~/.gradle/workout-signing.properties for release signing
#     (without it the release APK falls back to the debug key)
#
# Usage:
#   scripts/build_apk.sh            # release APK (signed per above)
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

cd android
if [ "${1:-}" = "--debug" ]; then
    ./gradlew assembleDebug --no-daemon
    APK="app/build/outputs/apk/debug/app-debug.apk"
else
    ./gradlew assembleRelease --no-daemon
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
    echo "Published on the stack: /download/workout-challenge.apk"
else
    echo "NOTE: stack not running - skipped publishing. Copy the apk onto"
    echo "      the server later, e.g.:"
    echo "      docker compose cp src-frontend/android/$APK workoutchallenge:/workout_challenge/src-backend/data/downloads/workout-challenge.apk"
fi

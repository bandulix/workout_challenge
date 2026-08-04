#!/bin/bash
# Build the Workout Challenge Android APK for THIS deployment.
#
# The APK is part of the full stack: it reads the server address from
# the deployment's own .env (MAIN_HOST), so the app always knows which
# server to talk to - no manual address entry on the phone, no rebuild
# guesswork.
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
    echo "ERROR: MAIN_HOST is not set in .env - the APK would not know its server." >&2
    exit 1
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
echo "Copy it to your phone (or host it on your server) and install."

#!/bin/bash
# Fetch the APK of the latest GitHub Release and publish it on this
# stack (/download/workout-challenge.apk + apk-version.json), so the
# app and the in-app update banner always match the deployed version.
#
# The CI (prod-deploy.yml, "apk" job) builds a generic APK on every
# release - this script is its server-side counterpart. Run it after
# `docker compose pull && docker compose up -d`, e.g. from cron.
#
# Needs: gh CLI authenticated (or GITHUB_TOKEN set) - or pass the tag:
#   scripts/update_apk_from_release.sh            # latest release
#   scripts/update_apk_from_release.sh 0.9.1      # specific tag
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="bandulix/workout_challenge"
TAG="${1:-}"

if [ -z "$TAG" ]; then
    TAG="$(gh release view --repo "$REPO" --json tagName --jq .tagName)"
fi
echo "Fetching APK for release $TAG"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
gh release download "$TAG" --repo "$REPO" \
    --pattern "workout-challenge.apk" --pattern "apk-version.json" \
    --dir "$TMPDIR" --clobber

# Publish onto the running stack (volume-backed downloads dir).
docker compose exec -T workoutchallenge \
    sh -c 'mkdir -p /workout_challenge/src-backend/data/downloads'
docker compose cp "$TMPDIR/workout-challenge.apk" \
    workoutchallenge:/workout_challenge/src-backend/data/downloads/workout-challenge.apk
chmod 644 "$TMPDIR/apk-version.json"
docker compose cp "$TMPDIR/apk-version.json" \
    workoutchallenge:/workout_challenge/src-backend/data/downloads/apk-version.json

echo "Published $TAG on the stack: /download/workout-challenge.apk"

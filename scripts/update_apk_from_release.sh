#!/bin/bash
# Fetch the APK of a GitHub Release and publish it on this stack
# (/download/workout-challenge.apk + apk-version.json), so the app and
# the in-app update banner always match the deployed version.
#
# The CI (prod-deploy.yml, "apk" job) builds a generic APK on every
# release - this script is its server-side counterpart. Run it after
# `docker compose pull && docker compose up -d`, e.g. from cron.
#
# No gh CLI needed - plain curl + python3. For private forks export
# GITHUB_TOKEN (read access) so the API calls pass.
#
# The GitHub repo is auto-detected from the running image's
# org.opencontainers.image.source label (set by the CI build), with the
# git remote as fallback; override via REPO_SLUG=owner/name.
#
#   scripts/update_apk_from_release.sh            # latest release
#   scripts/update_apk_from_release.sh 0.9.1      # specific tag
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER_DIR="/workout_challenge/src-backend/data/downloads"
TAG="${1:-latest}"

# --- which GitHub repo? -------------------------------------------------
REPO_SLUG="${REPO_SLUG:-}"
if [ -z "$REPO_SLUG" ]; then
    CID="$(docker compose ps -q workoutchallenge 2>/dev/null | head -1 || true)"
    if [ -n "$CID" ]; then
        SRC="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.source" }}' "$CID" 2>/dev/null || true)"
        REPO_SLUG="${SRC#https://github.com/}"
    fi
fi
if [ -z "$REPO_SLUG" ] && git remote get-url origin >/dev/null 2>&1; then
    URL="$(git remote get-url origin)"
    URL="${URL%.git}"
    URL="${URL#https://github.com/}"
    URL="${URL#git@github.com:}"
    REPO_SLUG="$URL"
fi
if [ -z "$REPO_SLUG" ] || ! [[ "$REPO_SLUG" =~ ^[^/]+/[^/]+$ ]]; then
    echo "ERROR: cannot determine the GitHub repo - set REPO_SLUG=owner/name." >&2
    exit 1
fi

# --- stack must be running ----------------------------------------------
if ! docker compose ps --status running 2>/dev/null | grep -q workoutchallenge; then
    echo "ERROR: the stack is not running - start it first (docker compose up -d)." >&2
    exit 1
fi

# --- fetch the release assets -------------------------------------------
AUTH=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
    AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi
if [ "$TAG" = "latest" ]; then
    API="https://api.github.com/repos/${REPO_SLUG}/releases/latest"
else
    API="https://api.github.com/repos/${REPO_SLUG}/releases/tags/${TAG}"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Fetching release ${TAG} from github.com/${REPO_SLUG} ..."
curl -fsSL "${AUTH[@]}" "$API" -o "$TMP/release.json"

GITHUB_TOKEN="${GITHUB_TOKEN:-}" python3 - "$TMP/release.json" "$TMP" <<'EOF'
import json, os, sys, urllib.request

release = json.load(open(sys.argv[1]))
outdir = sys.argv[2]
token = os.environ.get("GITHUB_TOKEN")
wanted = ["workout-challenge.apk", "apk-version.json"]
found = []
for asset in release.get("assets", []):
    if asset["name"] in wanted:
        req = urllib.request.Request(asset["browser_download_url"])
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req) as r, open(os.path.join(outdir, asset["name"]), "wb") as f:
            f.write(r.read())
        found.append(asset["name"])
missing = [n for n in wanted if n not in found]
if missing:
    sys.exit(f"ERROR: release {release.get('tag_name')} has no {', '.join(missing)} attached - "
             f"did the 'apk' CI job succeed for that release?")
print(f"Downloaded {', '.join(found)} from release {release.get('tag_name')}")
EOF

# --- publish onto the running stack (volume-backed downloads dir) -------
chmod 644 "$TMP/workout-challenge.apk" "$TMP/apk-version.json"
docker compose exec -T workoutchallenge sh -c "mkdir -p $CONTAINER_DIR"
docker compose cp "$TMP/workout-challenge.apk" "workoutchallenge:$CONTAINER_DIR/workout-challenge.apk"
docker compose cp "$TMP/apk-version.json" "workoutchallenge:$CONTAINER_DIR/apk-version.json"

echo "Published on the stack: /download/workout-challenge.apk (+ apk-version.json)"

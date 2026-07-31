#!/usr/bin/env python3
"""Render /usr/share/nginx/html/config.js from the runtime environment.

The previous supervisord config inlined the env vars into a JS string
literal with shell quoting, which broke (and was a JS injection vector)
when SENTRY_DSN or STRAVA_CLIENT_ID contained a quote, backslash,
forward slash, or control character.  This script is the single
source of truth for that file: it JSON-encodes the values so the
result is always a valid JS literal.

Expected output:

    window.RUNTIME_CONFIG = {"REACT_APP_SENTRY_DSN": "...", "REACT_APP_STRAVA_CLIENT_ID": "..."};
"""
import json
import os
import sys

OUT_PATH = os.environ.get("RUNTIME_CONFIG_OUT", "/usr/share/nginx/html/config.js")

config = {
    "REACT_APP_SENTRY_DSN": os.environ.get("SENTRY_DSN", ""),
    "REACT_APP_STRAVA_CLIENT_ID": os.environ.get("STRAVA_CLIENT_ID", ""),
    # Optional convenience for the push opt-in flow. When blank the
    # frontend fetches the key from /api/push/status/ instead, which
    # also covers the auto-generated-keypair case.
    "REACT_APP_VAPID_PUBLIC_KEY": os.environ.get("VAPID_PUBLIC_KEY", ""),
}

# json.dumps always produces a syntactically valid JS literal (modulo
# Unicode escapes, which V8 handles transparently).
payload = "window.RUNTIME_CONFIG = " + json.dumps(config) + ";\n"

try:
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(payload)
except OSError as exc:
    print(f"render_config_js: failed to write {OUT_PATH}: {exc}", file=sys.stderr)
    sys.exit(1)
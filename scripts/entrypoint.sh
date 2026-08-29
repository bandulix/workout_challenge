#!/bin/sh
# Entrypoint for the workout_challenge container.
#
# Runs once at container start. Performs the schema migrations and
# static-file collection that the previous supervisord.conf did inline
# *from every gunicorn worker*, which had two problems:
#   1. Three gunicorn workers all racing to call `manage.py migrate`
#      simultaneously, sometimes producing intermittent
#      "relation already exists" errors on first boot.
#   2. `manage.py makemigrations` running in production, where schema
#      changes belong in the image build (or a dedicated migration
#      deploy step), never at request-serving time.
#
# We call migrate exactly once here, gated behind a short Postgres
# healthcheck, so workers only ever start once the schema is settled.
set -e

cd /workout_challenge/src-backend

# Wait for Postgres if the DATABASE_URL points at one - the compose
# stack wires up `depends_on: condition: service_healthy`, so this is
# just belt-and-braces for the SQLite case or odd deployment paths.
if [ -n "$POSTGRES_HOST" ]; then
    echo "entrypoint: waiting for Postgres at $POSTGRES_HOST:${POSTGRES_PORT:-5432}..."
    until python3 -c "
import os, socket
s = socket.socket()
s.settimeout(2)
try:
    s.connect((os.environ['POSTGRES_HOST'], int(os.environ.get('POSTGRES_PORT', 5432))))
    s.close()
except Exception:
    raise SystemExit(1)
" >/dev/null 2>&1; do
        sleep 2
    done
    echo "entrypoint: Postgres reachable."
fi

# The workers run as the unprivileged `app` user (see supervisord.conf).
# Make sure the data volume (SQLite db, media uploads, vapid.json) is
# writable by it - named volumes already inherit the image ownership,
# but bind mounts arrive root-owned.
chown -R app:app /workout_challenge/src-backend/data
# nginx (X-Accel-Redirect) runs as user `nginx`, not `app`. Avatar/card
# thumbs used to be 0600 from mkstemp; nginx then 403'd every
# /api/.../picture/?size=… GET, which CrowdSec http-probing bans as a scan.
if [ -d /workout_challenge/src-backend/data/media ]; then
    chmod -R a+rX /workout_challenge/src-backend/data/media || true
fi

# Migrations (idempotent). Never run `makemigrations` here. Run as the
# app user so a SQLite database file is created with the right owner.
echo "entrypoint: applying migrations..."
su app -s /bin/sh -c "python3 manage.py migrate --noinput"

# Static files for the admin / DRF browsable API.
echo "entrypoint: collecting static files..."
python3 manage.py collectstatic --noinput || true

# Hand off to supervisord which starts nginx / celery / gunicorn.
exec "$@"
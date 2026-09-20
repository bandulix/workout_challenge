#!/bin/sh
# Backup Workout Challenge: Postgres dump + the django_data volume
# (uploads, vapid.json) into timestamped tarballs, with retention.
#
# Run on the Docker host, e.g. weekly via cron:
#   15 4 * * 1 /opt/workout_challenge/scripts/backup.sh >> /var/log/wc-backup.log 2>&1
#
# Restore: stop the stack, untar the data volume, drop+restore the DB:
#   docker compose down
#   docker run --rm -v <project>_django_data:/data -v "$BACKUP_DIR":/b alpine tar xzf /b/<file>-data.tar.gz -C /data
#   docker compose up -d database && cat /b/<file>-db.sql | docker compose exec -T database psql -U postgres -d workoutchallenge
set -eu

COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-$COMPOSE_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-28}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/$STAMP"

mkdir -p "$OUT"
cd "$COMPOSE_DIR"

echo "[backup] $STAMP: database dump"
docker compose exec -T database pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-workoutchallenge}" --clean --if-exists > "$OUT/$STAMP-db.sql"

echo "[backup] $STAMP: django data volume (media, vapid.json)"
docker run --rm \
    -v "$(docker compose volume ls -q | grep django_data | head -1):/data:ro" \
    -v "$OUT":/backup \
    alpine tar czf "/backup/$STAMP-data.tar.gz" -C /data .

echo "[backup] $STAMP: prune backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf {} +

echo "[backup] $STAMP: done -> $OUT"

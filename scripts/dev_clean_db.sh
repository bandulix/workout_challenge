#!/bin/sh
# Dev-only helper: wipe the local database, caches and migration state.
# Deliberately restricted to this repository - a previous version also
# deleted migration files inside the installed Django/concrete packages
# under /opt/miniconda3, corrupting the dev machine's site-packages.
set -e
cd "$(dirname "$0")/../src-backend"
read -r -p "This wipes the local dev DB and per-app migration files (db_migrations/ is kept - it is versioned). Continue? [y/N] " answer
[ "$answer" = "y" ] || exit 1
redis-cli flushall || echo "Redis Cache could not be flushed"
find . -path "./*/migrations/*.py" -not -name "__init__.py" -delete
# -print0/xargs -0: safe for paths containing whitespace.
find . \( -name "__pycache__" -o -name "*.pyc" -o -name "*.pyo" -o -name "*.sqlite3" \) -print0 | xargs -0 rm -rf

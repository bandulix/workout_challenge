#!/bin/sh
# Dev-only helper: wipe the local database, caches and migration state.
# Deliberately restricted to this repository - a previous version also
# deleted migration files inside the installed Django/concrete packages
# under /opt/miniconda3, corrupting the dev machine's site-packages.
set -e
cd "$(dirname "$0")/../src-backend"
redis-cli flushall || echo "Redis Cache could not be flushed"
find . -path "./*/migrations/*.py" -not -name "__init__.py" -delete
find . -path "./db_migrations/*" -delete
# -print0/xargs -0: safe for paths containing whitespace.
find . \( -name "__pycache__" -o -name "*.pyc" -o -name "*.pyo" -o -name "*.sqlite3" \) -print0 | xargs -0 rm -rf

FROM node:20 AS frontend
WORKDIR /workout_challenge/src-frontend
COPY src-frontend/ /workout_challenge/src-frontend/
# npm ci: install exactly what package-lock.json pins (reproducible).
# INLINE_RUNTIME_CHUNK=false: no inline <script> in the built
# index.html, so nginx can serve a CSP without script-src 'unsafe-inline'.
RUN npm ci && INLINE_RUNTIME_CHUNK=false npm run build

FROM python:3.11-alpine AS backend
WORKDIR /workout_challenge/src-backend
COPY src-backend/ /workout_challenge/src-backend/

# psycopg2-binary is in requirements.txt, so no C build toolchain needed.
# (Kept just the runtime libs for any wheel that needs them.)
RUN apk add --no-cache postgresql-libs
RUN pip install --no-cache-dir -r requirements.txt

# Collect Django static files. site_settings/apps.py:ready() is now
# defensive against a missing table so it works even before migrations.
# Django imports settings.py at startup which requires SECRET_KEY
# (production) and DEBUG (controls the dev fallback). We set both
# explicitly here so the build doesn't need to read .env - the real
# runtime values come from the docker-compose environment block.
RUN DEBUG=true SECRET_KEY=build-time-only-not-a-real-secret \
    python3 manage.py collectstatic --noinput

FROM python:3.11-alpine AS final

# Release version for the "What's new" popup - CI passes the git tag.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# Install system dependencies. build-base / gcc are intentionally NOT
# installed here - gunicorn, openai, celery etc. all ship as pure
# Python wheels on Alpine, so we don't need a C toolchain. Keeping
# this layer small also dodges the flaky gcc extraction I/O errors
# on slow docker storage drivers.
RUN apk add --no-cache nginx supervisor redis postgresql-libs

# Unprivileged user for the app processes (gunicorn / celery / flower).
# supervisord itself stays root so nginx can bind :80 and it can spawn
# children as other users; the worker processes no longer run as root.
RUN adduser -D -H app

# Set workdir
WORKDIR /workout_challenge

# Copy backend code
COPY --from=backend /workout_challenge/src-backend /workout_challenge/src-backend

# Copy requirements and install them again
COPY src-backend/requirements.txt /workout_challenge/src-backend/requirements.txt
RUN pip install --no-cache-dir -r /workout_challenge/src-backend/requirements.txt && pip install gunicorn

# Copy frontend build
COPY --from=frontend /workout_challenge/src-frontend/build /usr/share/nginx/html

# Copy configs
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY supervisord.conf /etc/supervisord.conf
COPY scripts/render_config_js.py /usr/local/bin/render_config_js.py
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh

# Changelog for the "What's new" popup (/api/version/ parses it).
COPY CHANGELOG.md /workout_challenge/CHANGELOG.md
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/render_config_js.py

# NGINX runtime folder
RUN mkdir -p /run/nginx

# Django data folder with mirgations and sqlite database. Owned by the
# app user so the unprivileged workers can write the DB / media /
# vapid.json into it (named volumes inherit these ownership bits on
# first mount; the entrypoint re-chowns for bind mounts).
RUN mkdir -p /workout_challenge/src-backend/data && chown -R app:app /workout_challenge/src-backend/data
VOLUME /workout_challenge/src-backend/data

# the app
EXPOSE 80
# celery flower - monitoring of celery tasks
EXPOSE 5555

CMD ["/usr/local/bin/entrypoint.sh", "/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
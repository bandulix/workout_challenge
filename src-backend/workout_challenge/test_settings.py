"""Settings for the test suite and CI.

The production settings always point the cache and Celery broker at
Redis (the compose stack always has it). Tests must not need a running
Redis or SMTP server, and they must not write uploaded files into the
runtime data volume.
"""
import tempfile

from .settings import *  # noqa: F403

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "workout-tests",
    }
}

# memory:// is in-process. Tests mock delay/apply_async; an accidental
# real .delay() must not hang waiting for Redis. Do NOT set
# CELERY_TASK_ALWAYS_EAGER: workout.save() enqueues a coach comment,
# and running that task inside setUp poisons the idempotency tests.
CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache+memory://"

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

MEDIA_ROOT = tempfile.mkdtemp(prefix="wc-test-media-")

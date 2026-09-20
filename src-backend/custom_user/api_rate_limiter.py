# myapp/monitor.py
import logging
from datetime import datetime, timezone

from django.core.cache import cache

logger = logging.getLogger(__name__)


class RateLimitExceeded(Exception):
    """Raised when the API rate limit is exceeded."""
    pass

class APIRequestMonitor:
    """ API request rate limiter.

    Rate limits come from the environment (STRAVA_LIMIT_15MIN /
    STRAVA_LIMIT_DAY) via resolve_strava_settings() - env-only, no DB
    override.

    Counters live in the shared cache (Redis in production): gunicorn and
    celery run multiple processes, and in-process counters multiplied the
    real budget by the process count.
    """
    _SLOT_TTL = 60 * 20        # outlives a 15-min slot
    _DAY_TTL = 60 * 60 * 48    # outlives a day

    def _limits(self):
        # Lazy import to avoid circular-import at startup.
        from site_settings.models import resolve_strava_settings
        cfg = resolve_strava_settings()
        return cfg["limit_15min"], cfg["limit_day"]

    def _slot_key(self):
        now = datetime.now(timezone.utc)
        slot = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
        return f"strava-rl:15min:{slot.isoformat()}"

    def _day_key(self):
        return f"strava-rl:day:{datetime.now(timezone.utc).date().isoformat()}"

    def _bump(self, key, ttl):
        """Atomic increment (cache.incr), creating the key if needed."""
        try:
            return cache.incr(key)
        except ValueError:
            cache.add(key, 0, ttl)
            return cache.incr(key)

    def _read(self, key):
        try:
            return int(cache.get(key, 0))
        except (TypeError, ValueError):
            return 0

    def log_request(self, response) -> bool:
        limit_15min, limit_day = self._limits()
        day_key = self._day_key()
        slot_key = self._slot_key()

        count_day = self._bump(day_key, self._DAY_TTL)

        if response.status_code == 429:
            cache.set(slot_key, limit_15min, self._SLOT_TTL)
            raise RateLimitExceeded("API rate limit exceeded")

        count_15min = self._read(slot_key)
        if count_15min >= limit_15min or count_day >= limit_day:
            raise RateLimitExceeded("API rate limit probably exceeded")

        count_15min = self._bump(slot_key, self._SLOT_TTL)
        logger.info('Strava API request (15min: %s / %s, day: %s / %s)', count_15min, limit_15min, count_day, limit_day)
        return True

    def count_requests(self):
        return {
            "requests_15min": self._read(self._slot_key()),
            "requests_today": self._read(self._day_key()),
        }

    def ok_workout_requests(self):
        limit_15min, limit_day = self._limits()
        stats = self.count_requests()
        return ((stats["requests_today"] <= limit_day * 0.8) & (stats["requests_15min"] <= limit_15min * 0.66))

    def ok_linkage_requests(self):
        limit_15min, limit_day = self._limits()
        stats = self.count_requests()
        return ((stats["requests_today"] <= limit_day) & (stats["requests_15min"] <= limit_15min))


# Singleton instance
strava_api_monitor = APIRequestMonitor()

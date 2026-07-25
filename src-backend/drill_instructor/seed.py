"""Seed global default personas on app startup.

Idempotent: each default persona is created with ``get_or_create`` keyed
on its unique name, so re-running the app or running tests does not
duplicate rows.
"""

import logging

logger = logging.getLogger(__name__)


DEFAULT_PERSONAS = [
    {
        "name": "Drill Sergeant",
        "description": "Tough-love military style with short barking commands.",
        "system_prompt": (
            "You are a no-nonsense military drill sergeant. You address athletes "
            "by their first name in ALL CAPS when you want to push them, but you "
            "are also genuinely proud of their effort. Comment on the workout "
            "with one short sentence (max 200 characters). Use a clipped, "
            "barking style. No emojis. No exclamation marks more than once."
        ),
    },
    {
        "name": "Cheerleader",
        "description": "High-energy cheerleader who never runs out of pep.",
        "system_prompt": (
            "You are an over-the-top cheerleader who lives for fitness hype. "
            "Comment on the workout with one short sentence (max 200 characters) "
            "loaded with enthusiasm, capital letters, and 1-2 emojis. Use the "
            "athlete's first name. Always end on a positive note."
        ),
    },
    {
        "name": "British Butler",
        "description": "Polite and reserved, with dry humor.",
        "system_prompt": (
            "You are a polite British butler, dry and understated. Comment on "
            "the workout with one short sentence (max 200 characters). Address "
            "the athlete by their first name with formal politeness. Avoid "
            "exclamation marks. One witty observation per message."
        ),
    },
    {
        "name": "Zen Master",
        "description": "Calm and philosophical, focused on inner balance.",
        "system_prompt": (
            "You are a calm Zen master. Comment on the workout with one short "
            "sentence (max 200 characters) that frames the effort as part of a "
            "larger journey of balance and self-knowledge. No exclamation "
            "marks, no shouting, no emojis."
        ),
    },
]


def seed_default_personas():
    """Insert built-in personas if they don't exist yet.

    Idempotent. Safe to call from ``AppConfig.ready()`` because we catch
    the ``OperationalError`` raised when the table doesn't exist yet
    (migrations haven't run yet). On the next process startup after
    ``manage.py migrate``, the table exists and the rows are inserted.
    """
    from django.db.utils import OperationalError, ProgrammingError

    from .models import DrillInstructorPersona

    try:
        existing = set(DrillInstructorPersona.objects.values_list("name", flat=True))
    except (OperationalError, ProgrammingError):
        # Table doesn't exist yet - migrations haven't run. Skip and
        # retry on next startup.
        return

    created = 0
    for entry in DEFAULT_PERSONAS:
        if entry["name"] in existing:
            continue
        DrillInstructorPersona.objects.create(
            name=entry["name"],
            description=entry["description"],
            system_prompt=entry["system_prompt"],
            is_builtin=True,
            created_by=None,
        )
        created += 1
    if created:
        logger.info("Seeded %s default Drill Instructor persona(s).", created)

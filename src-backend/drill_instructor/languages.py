"""Stable reply-language codes for a coach.

The persona's voice stays in ``system_prompt``. This list only chooses
which language that voice answers in. Codes are stored; names are shown.
"""

COACH_LANGUAGES = (
    ("en", "English"),
    ("de", "German"),
    ("es", "Spanish"),
    ("fr", "French"),
    ("pt", "Portuguese"),
    ("it", "Italian"),
    ("nl", "Dutch"),
    ("pl", "Polish"),
    ("tr", "Turkish"),
    ("ru", "Russian"),
    ("ar", "Arabic"),
    ("hi", "Hindi"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("zh", "Chinese"),
)

COACH_LANGUAGE_NAMES = dict(COACH_LANGUAGES)
COACH_LANGUAGE_CODES = frozenset(COACH_LANGUAGE_NAMES)


def coach_language_name(code) -> str:
    """English name of a stored code. Missing or unknown codes are English."""
    if not code:
        return "English"
    return COACH_LANGUAGE_NAMES.get(str(code).strip().lower(), "English")

"""Shared template context for every outbound email."""
from django.conf import settings

SOURCE_URL = "https://github.com/bandulix/workout_challenge"
APP_NAME = "Workout Challenge"
TAGLINE = "Your AI Drill Instructor"


def reply_to_address():
    if settings.EMAIL_REPLY_TO:
        return settings.EMAIL_REPLY_TO[0]
    return settings.EMAIL_FROM


def base_email_context(user):
    return {
        "first_name": user.first_name,
        "MAIN_HOST": settings.MAIN_HOST,
        "EMAIL_REPLY_TO": reply_to_address(),
        "SOURCE_URL": SOURCE_URL,
        "APP_NAME": APP_NAME,
        "TAGLINE": TAGLINE,
    }

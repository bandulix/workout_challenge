from django.apps import AppConfig


class DrillInstructorConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "drill_instructor"
    verbose_name = "AI Drill Instructor"

    def ready(self):
        from .seed import seed_default_personas
        seed_default_personas()

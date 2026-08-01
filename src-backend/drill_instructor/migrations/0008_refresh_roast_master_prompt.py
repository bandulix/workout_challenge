"""Refresh the built-in Roast Master persona's system prompt.

``seed_default_personas()`` deliberately never overwrites the
``system_prompt`` of an existing built-in persona (staff may have
customised it), so the reworked Roast Master prompt - longer multi-sentence
roasts that must address the athlete by @FirstName instead of just
repeating the activity back - would never reach deployments where the
persona was already seeded. This data migration syncs the built-in row
once to the current seed value.
"""

from django.db import migrations

from drill_instructor.seed import DEFAULT_PERSONAS


def refresh_roast_master_prompt(apps, schema_editor):
    DrillInstructorPersona = apps.get_model("drill_instructor", "DrillInstructorPersona")
    entry = next(p for p in DEFAULT_PERSONAS if p["name"] == "Roast Master")
    DrillInstructorPersona.objects.filter(name="Roast Master", is_builtin=True).update(
        system_prompt=entry["system_prompt"]
    )


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0007_seed_inactivity_nudge_periodictask"),
    ]

    operations = [
        # No meaningful reverse - the old prompt text is gone either way.
        migrations.RunPython(refresh_roast_master_prompt, migrations.RunPython.noop),
    ]

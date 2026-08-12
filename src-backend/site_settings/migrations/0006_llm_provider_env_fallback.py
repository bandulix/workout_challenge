# The llm_provider default "custom" was always truthy, so the DB row
# permanently shadowed the LLM_PROVIDER env var (resolution is DB → env)
# and a .env change + restart never took effect. Blank now means "follow
# the deployment". Existing rows that merely hold the old default are
# rewritten - resolution still lands on "custom" via the fallback chain
# (env LLM_PROVIDER, then 'custom'), so only deployments that actually
# set LLM_PROVIDER in their .env change behavior: theirs starts working.

from django.db import migrations, models


def unshadow_env_default(apps, schema_editor):
    SiteSettings = apps.get_model("site_settings", "SiteSettings")
    SiteSettings.objects.filter(llm_provider="custom").update(llm_provider="")


class Migration(migrations.Migration):

    dependencies = [
        ("site_settings", "0005_sitesettings_points_sport_factors"),
    ]

    operations = [
        migrations.AlterField(
            model_name="sitesettings",
            name="llm_provider",
            field=models.CharField(
                blank=True,
                choices=[
                    ("custom", "Custom (OpenAI-compatible)"),
                    ("MiniMax", "MiniMax"),
                    ("openai", "OpenAI"),
                ],
                default="",
                help_text=(
                    "Preset provider. Picks sane defaults for base URL + model; you can override below. "
                    "Blank = follow the deployment (.env LLM_PROVIDER / 'custom')."
                ),
                max_length=20,
            ),
        ),
        migrations.RunPython(unshadow_env_default, migrations.RunPython.noop),
    ]

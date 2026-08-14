from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("site_settings", "0006_llm_provider_env_fallback"),
    ]

    operations = [
        migrations.AddField(
            model_name="sitesettings",
            name="roast_image_prompt",
            field=models.TextField(
                blank=True,
                default="",
                help_text=(
                    "Template for the photo-roast image edit. Blank = built-in default. "
                    "Optional placeholders: {persona_name}, {persona_style}, {caption}, "
                    "{caption_instruction} (the dynamic 'work the caption into the joke / "
                    "no text' sentence)."
                ),
            ),
        ),
    ]

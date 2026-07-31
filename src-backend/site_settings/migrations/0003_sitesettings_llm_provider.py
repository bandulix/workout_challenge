from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("site_settings", "0002_strava_email_settings"),
    ]

    operations = [
        migrations.AddField(
            model_name="sitesettings",
            name="llm_provider",
            field=models.CharField(
                blank=True,
                choices=[
                    ("custom", "Custom (OpenAI-compatible)"),
                    ("MiniMax", "MiniMax"),
                    ("openai", "OpenAI"),
                ],
                default="custom",
                help_text="Preset provider. Picks sane defaults for base URL + model; you can override below.",
                max_length=20,
            ),
        ),
    ]

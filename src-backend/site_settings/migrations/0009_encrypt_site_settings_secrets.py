# Widen secret CharFields for Fernet ciphertext and encrypt any legacy
# plaintext Site Settings secrets already in the database.

from django.db import migrations, models


_SECRET_FIELDS = (
    "llm_api_key",
    "strava_client_secret",
    "email_host_password",
    "health_developer_password",
)


def _encrypt_existing(apps, schema_editor):
    SiteSettings = apps.get_model("site_settings", "SiteSettings")
    from custom_user.token_crypto import encrypt_token

    for row in SiteSettings.objects.all():
        changed = []
        for name in _SECRET_FIELDS:
            value = getattr(row, name, "") or ""
            if value and not value.startswith("gAAAA"):
                setattr(row, name, encrypt_token(value))
                changed.append(name)
        if changed:
            row.save(update_fields=changed)


def _noop_reverse(apps, schema_editor):
    # Leaving ciphertext in place is safe: decrypt_token still reads it,
    # and rotating SECRET_KEY / GARMIN_TOKEN_KEY requires re-entry anyway.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("site_settings", "0008_remove_roast_image_prompt"),
    ]

    operations = [
        migrations.AlterField(
            model_name="sitesettings",
            name="llm_api_key",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Stored Fernet-encrypted at rest.",
                max_length=500,
            ),
        ),
        migrations.AlterField(
            model_name="sitesettings",
            name="strava_client_secret",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Stored Fernet-encrypted at rest.",
                max_length=500,
            ),
        ),
        migrations.AlterField(
            model_name="sitesettings",
            name="email_host_password",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Stored Fernet-encrypted at rest.",
                max_length=500,
            ),
        ),
        migrations.AlterField(
            model_name="sitesettings",
            name="health_developer_password",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Stored Fernet-encrypted at rest.",
                max_length=500,
            ),
        ),
        migrations.RunPython(_encrypt_existing, _noop_reverse),
    ]

# Existing accounts already receive mail. Mark them confirmed so the
# new verify-before-welcome gate does not silence weekly / board mail
# for people who signed up before confirmation existed.

from django.db import migrations


def mark_existing_verified(apps, schema_editor):
    CustomUser = apps.get_model("custom_user", "CustomUser")
    CustomUser.objects.all().update(is_verified=True)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("custom_user", "0009_ensure_health_sync_beat"),
    ]

    operations = [
        migrations.RunPython(mark_existing_verified, noop),
    ]

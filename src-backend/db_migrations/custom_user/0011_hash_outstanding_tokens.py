import hashlib

from django.db import migrations


def hash_outstanding_tokens(apps, schema_editor):
    table = "token_blacklist_outstandingtoken"
    if table not in schema_editor.connection.introspection.table_names():
        return
    try:
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
    except Exception:
        return
    for row in OutstandingToken.objects.iterator():
        token = row.token or ""
        if token and not str(token).startswith("sha256:"):
            row.token = "sha256:" + hashlib.sha256(str(token).encode()).hexdigest()
            row.save(update_fields=["token"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("custom_user", "0010_verify_existing_users"),
        ("token_blacklist", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(hash_outstanding_tokens, noop),
    ]

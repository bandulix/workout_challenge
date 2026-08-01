# Strava refresh tokens are now stored Fernet-encrypted at rest (see
# custom_user/token_crypto.py); encrypted values are ~100+ chars, far
# beyond the old max_length=40.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('custom_user', '0005_customuser_garmin_email_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='customuser',
            name='strava_refresh_token',
            field=models.CharField(blank=True, max_length=500, null=True),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("site_settings", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="sitesettings",
            name="strava_client_id",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="strava_client_secret",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="strava_limit_15min",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="strava_limit_day",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="email_host",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="email_port",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="email_host_user",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="email_host_password",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="email_use_tls",
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="email_use_ssl",
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="email_from",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="email_reply_to",
            field=models.CharField(blank=True, default="", help_text="Comma-separated list of reply-to addresses.", max_length=400),
        ),
    ]
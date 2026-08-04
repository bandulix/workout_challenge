# Site Settings: Open Wearables connection (URLs + developer credentials)
# for the Apple Health / Health Connect connector. A developer JWT works
# on every OW endpoint, so one credential pair covers polling and
# invitation-code onboarding.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('site_settings', '0003_sitesettings_llm_provider'),
    ]

    operations = [
        migrations.AddField(
            model_name='sitesettings',
            name='health_base_url',
            field=models.CharField(blank=True, default='', max_length=300),
        ),
        migrations.AddField(
            model_name='sitesettings',
            name='health_public_url',
            field=models.CharField(blank=True, default='', max_length=300),
        ),
        migrations.AddField(
            model_name='sitesettings',
            name='health_developer_email',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='sitesettings',
            name='health_developer_password',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
    ]

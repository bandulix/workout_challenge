# Site Settings: Open Wearables connection (base URL + API key) for the
# Apple Health / Health Connect connector.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('site_settings', '0003_sitesettings_llm_provider'),
    ]

    operations = [
        migrations.AddField(
            model_name='sitesettings',
            name='health_api_key',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
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
    ]

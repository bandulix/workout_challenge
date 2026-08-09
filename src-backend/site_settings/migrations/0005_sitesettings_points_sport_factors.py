# Site Settings: per-activity-type point multipliers (admin-editable).
# Missing keys mean a neutral factor of 1.0 - applied by the scorer.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('site_settings', '0004_sitesettings_health'),
    ]

    operations = [
        migrations.AddField(
            model_name='sitesettings',
            name='points_sport_factors',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]

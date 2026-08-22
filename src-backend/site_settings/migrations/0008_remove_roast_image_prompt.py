# The roast image prompt is hardcoded again (coach-in-scene remix);
# the admin-editable template is gone.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("site_settings", "0007_sitesettings_roast_image_prompt"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="sitesettings",
            name="roast_image_prompt",
        ),
    ]

# Adds the optional custom profile picture upload for personas (admin-only
# via the API). When set it takes precedence over the avatar artwork/emoji.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0009_random_daily_push"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorpersona",
            name="profile_picture",
            field=models.ImageField(
                blank=True,
                help_text="Custom uploaded profile picture. Takes precedence over the avatar artwork/emoji when set.",
                null=True,
                upload_to="persona_pics/",
            ),
        ),
    ]

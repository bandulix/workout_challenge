# Adds the persona "identity" fields used by the Coach UI: avatar artwork
# key, a short tagline and a theme colour. All optional so existing custom
# personas keep working - they simply fall back to a default avatar.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('drill_instructor', '0003_drop_matrix_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='drillinstructorpersona',
            name='tagline',
            field=models.CharField(
                blank=True,
                default='',
                help_text="Short one-liner shown under the persona's name in the Coach UI.",
                max_length=80,
            ),
        ),
        migrations.AddField(
            model_name='drillinstructorpersona',
            name='avatar',
            field=models.CharField(
                blank=True,
                default='',
                help_text=(
                    'Avatar artwork key. Either one of the built-in keys shipped in '
                    'the frontend (/personas/<key>.svg) or a custom emoji character.'
                ),
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name='drillinstructorpersona',
            name='theme_color',
            field=models.CharField(
                blank=True,
                default='',
                help_text="Hex accent colour (e.g. #d7ff3e) used for the persona's avatar ring and chat bubbles.",
                max_length=7,
            ),
        ),
    ]

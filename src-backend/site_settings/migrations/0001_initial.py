from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="SiteSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("llm_api_key", models.CharField(blank=True, default="", max_length=200)),
                ("llm_base_url", models.CharField(blank=True, default="", max_length=300)),
                ("llm_model", models.CharField(blank=True, default="", max_length=80)),
                ("llm_email_model", models.CharField(blank=True, default="", max_length=80)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Site Settings",
                "verbose_name_plural": "Site Settings",
            },
        ),
    ]
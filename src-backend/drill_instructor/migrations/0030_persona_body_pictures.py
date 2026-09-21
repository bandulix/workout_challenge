# Optional full-body reference photos for (self-created) coaches. The
# roast/echo image edits use them as the body lock so the coach keeps a
# real build and outfit under the locked face.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0029_delete_echochallenge"),
    ]

    operations = [
        migrations.AddField(
            model_name="drillinstructorpersona",
            name="body_picture_1",
            field=models.ImageField(
                blank=True,
                help_text="Full-body reference photo 1 for image edits.",
                null=True,
                upload_to="persona_body_pics/",
            ),
        ),
        migrations.AddField(
            model_name="drillinstructorpersona",
            name="body_picture_2",
            field=models.ImageField(
                blank=True,
                help_text="Full-body reference photo 2 for image edits.",
                null=True,
                upload_to="persona_body_pics/",
            ),
        ),
        migrations.AddField(
            model_name="drillinstructorpersona",
            name="body_picture_3",
            field=models.ImageField(
                blank=True,
                help_text="Full-body reference photo 3 for image edits.",
                null=True,
                upload_to="persona_body_pics/",
            ),
        ),
    ]

# Hot-or-not votes on the coach's roasted photos (Coach page swipe box).

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('drill_instructor', '0014_photo_posts'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='DrillInstructorPhotoVote',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('hot', models.BooleanField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('message', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='photo_votes', to='drill_instructor.drillinstructormessage')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='drill_photo_votes', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name='drillinstructorphotovote',
            constraint=models.UniqueConstraint(fields=('message', 'user'), name='one_vote_per_roast'),
        ),
        migrations.AddIndex(
            model_name='drillinstructorphotovote',
            index=models.Index(fields=['message', 'hot'], name='roast_vote_tally'),
        ),
    ]

# Photo posts: participants share pictures in the coach's messaging
# feed; the coach reacts and participants reply (existing thread model).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('drill_instructor', '0013_fix_constraint_state_drift'),
    ]

    operations = [
        migrations.AddField(
            model_name='drillinstructormessage',
            name='image',
            field=models.ImageField(blank=True, null=True, upload_to='message_pics/'),
        ),
        migrations.AlterField(
            model_name='drillinstructormessage',
            name='kind',
            field=models.CharField(choices=[('activity', 'Workout comment'), ('test', 'Test message'), ('nudge', 'Inactivity nudge'), ('push', 'Random group push'), ('reply', 'Participant reply'), ('reaction', 'Coach reaction'), ('photo', 'Participant photo post')], default='activity', help_text="What triggered this message (a workout, a test, a quiet-day nudge, a random group push, a participant reply, or the coach's reaction to one).", max_length=12),
        ),
    ]

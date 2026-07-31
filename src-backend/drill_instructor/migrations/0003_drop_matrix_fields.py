# Drops the Matrix-specific columns added to DrillInstructorConfig by
# 0001_initial. The instructor no longer posts to a Matrix room; the
# remaining fields (enabled, persona, comment_on_activity,
# send_push_on_activity, audit-log bookkeeping) stay the same.
#
# Also drops matrix_event_id from DrillInstructorMessage - there's
# nowhere to record "the Matrix event id this was posted as" any more.

import django.db.models
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('drill_instructor', '0002_drillinstructorconfig_mention_in_matrix'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='drillinstructorconfig',
            name='matrix_homeserver',
        ),
        migrations.RemoveField(
            model_name='drillinstructorconfig',
            name='matrix_access_token',
        ),
        migrations.RemoveField(
            model_name='drillinstructorconfig',
            name='matrix_room_id',
        ),
        migrations.RemoveField(
            model_name='drillinstructorconfig',
            name='matrix_bot_display_name',
        ),
        migrations.RemoveField(
            model_name='drillinstructorconfig',
            name='mention_in_matrix',
        ),
        migrations.RemoveField(
            model_name='drillinstructormessage',
            name='matrix_event_id',
        ),
    ]

# Drop the matrix_user_id column. The AI Drill Instructor no longer
# posts to a Matrix room; the column was only used to enable real
# @-mentions there.

import django.db.models
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('custom_user', '0001_initial'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='customuser',
            name='matrix_user_id',
        ),
    ]

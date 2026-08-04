# Workout.health_id: dedup key for Apple Health / Health Connect
# workouts imported via Open Wearables (pendant to strava_id/garmin_id).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workouts', '0003_workout_workout_user_time'),
    ]

    operations = [
        migrations.AddField(
            model_name='workout',
            name='health_id',
            field=models.CharField(max_length=40, null=True, unique=True),
        ),
    ]

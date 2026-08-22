from rest_framework import serializers
import datetime

from .models import Workout


# Maximum workout duration we accept. The longest recorded single-
# session activity on Strava is around 24 hours; anything longer is a
# bug, a unit mismatch (e.g. duration in seconds vs minutes), or an
# attempt to inflate kcal/distance scoring downstream.
MAX_DURATION = datetime.timedelta(hours=24)


class WorkoutSerializer(serializers.ModelSerializer):
    def validate(self, data):
        if data.get('sport_type') == 'Steps' and not data.get('steps'):
            raise serializers.ValidationError({'steps': 'Steps field is required when sport type is Steps'})
        # Steps workouts should not be in the future (gives a small
        # defence against accidentally logging a future workout that
        # double-counts Steps vs. walk/run conversions).
        duration = data.get('duration')
        if duration is not None and duration > MAX_DURATION:
            raise serializers.ValidationError({'duration': 'Duration is unrealistically long (>24h).'})
        if duration is not None and duration < datetime.timedelta(0):
            raise serializers.ValidationError({'duration': 'Duration must be positive.'})
        return data

    def create(self, validated_data):
        # Explicit: persist then score. ``save(score=True)`` is the
        # public scoring path used by the three import connectors too.
        workout = Workout(**validated_data)
        workout.save(score=True)
        return workout

    def update(self, instance, validated_data):
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save(score=True)
        return instance

    class Meta:
        model = Workout
        fields = ['id', 'sport_type', 'start_datetime', 'duration', 'duration_seconds', 'intensity_category', 'kcal', 'distance', 'steps', 'strava_id']
        read_only_fields = ['id', 'duration_seconds', 'strava_id'] #'duration_seconds',
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
        kcal = data.get("kcal")
        if kcal is not None and float(kcal) > 20_000:
            raise serializers.ValidationError({"kcal": "Calories value is unrealistically high."})
        if kcal is not None and float(kcal) < 0:
            raise serializers.ValidationError({"kcal": "Calories must be positive."})
        distance = data.get("distance")
        if distance is not None and float(distance) > 500:
            raise serializers.ValidationError({"distance": "Distance is unrealistically long (>500 km)."})
        if distance is not None and float(distance) < 0:
            raise serializers.ValidationError({"distance": "Distance must be positive."})
        steps = data.get("steps")
        if steps is not None and int(steps) > 200_000:
            raise serializers.ValidationError({"steps": "Steps value is unrealistically high."})
        if steps is not None and int(steps) < 0:
            raise serializers.ValidationError({"steps": "Steps must be positive."})
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
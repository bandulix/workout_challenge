import datetime
from decimal import Decimal

from django.utils import timezone
from django.conf import settings
from django.db import models
from django.db.models import Sum

from custom_user.models import CustomUser
from competition.scorer import score_workout, unscore_workout

# Create your models here.

SPORT_TYPE_GROUPS = [
    ('GROUP_ANY', 'Group: All Sports'),
    ('GROUP_RUNNING', 'Group: Running (Run / Trail / Treadmill)'),
    ('GROUP_BIKING', 'Group: Biking/Cycling (Except E-Bike)'),
    ('GROUP_WALKING', 'Group: Walking (Walk / Wheelchair / Elliptical / Stepper)'),
    ('GROUP_RACKET', 'Group: Racket Sports (Tennis / Squash / Badminton / Pickleball / Padel / Racquetball / Table Tennis)'),
    ('GROUP_SOCIAL', 'Group: Ball Sports (Soccer / Basketball / Volleyball / Cricket / Golf)'),
    ('GROUP_COMBAT', 'Group: Combat Sports (Muay Thai / Boxing / Kickboxing / Martial Arts)'),
    ('GROUP_CLASSES_CARDIO', 'Group: Cardio Gym Classes (Crossfit / HIIT / Dance)'),
    ('GROUP_CLASSES_MINDFUL', 'Group: Mindfulness Classes (Yoga / Pilates)'),
    ('GROUP_WATER_ACTIVE', 'Group: Active Water Sports (Swim / Canoe / Kayak / Kitesurf / Rowing / Surfing / Windsurf)'),
]

SPORT_TYPES = [
    ('Steps', 'Total Daily Steps'),
    ('Badminton', 'Badminton'),
    ('Basketball', 'Basketball'),
    ('Boxing', 'Boxing'),
    ('Ride', 'Biking/Cycling'),
    ('EBikeRide', 'Biking/Cycling (E-Bike)'),
    ('GravelRide', 'Biking/Cycling (Gravel)'),
    ('Handcycle', 'Biking/Cycling (Handcycle)'),
    ('Velomobile', 'Biking/Cycling (Velomobile)'),
    ('VirtualRide', 'Biking/Cycling (Virtual)'),
    ('Canoeing', 'Canoe'),
    ('Cricket', 'Cricket'),
    ('Crossfit', 'Crossfit'),
    ('Dance', 'Dance'),
    ('Elliptical', 'Elliptical'),
    ('Golf', 'Golf'),
    ('HighIntensityIntervalTraining', 'High Intensity Interval Training (HIIT)'),
    ('Hike', 'Hike'),
    ('IceSkate', 'Ice Skate'),
    ('InlineSkate', 'Inline Skate'),
    ('Kayaking', 'Kayak'),
    ('Kickboxing', 'Kickboxing'),
    ('Kitesurf', 'Kitesurf'),
    ('MartialArts', 'Martial Arts'),
    ('MountainBikeRide', 'Mountain-Biking/Cycling'),
    ('EMountainBikeRide', 'Mountain-Biking/Cycling (E-Bike)'),
    ('MuayThai', 'Muay Thai'),
    ('Padel', 'Padel'),
    ('Pickleball', 'Pickleball'),
    ('Pilates', 'Pilates'),
    ('PhysicalTherapy', 'Physical Therapy'),
    ('Racquetball', 'Racquetball'),
    ('RockClimbing', 'Rock Climbing'),
    ('Rowing', 'Rowing (Outdoor)'),
    ('VirtualRow', 'Rowing (Virtual)'),
    ('Run', 'Run'),
    ('TrailRun', 'Run (Trail)'),
    ('VirtualRun', 'Run (Treadmill / Vitual)'),
    ('Volleyball', 'Volleyball'),
    ('Sail', 'Sail'),
    ('Skateboard', 'Skateboard'),
    ('AlpineSki', 'Ski (Alpine)'),
    ('BackcountrySki', 'Ski (Backcountry)'),
    ('NordicSki', 'Ski (Nordic)'),
    ('RollerSki', 'Ski (Roller/Inliner)'),
    ('Snowboard', 'Snowboard'),
    ('Soccer', 'Soccer / Football'),
    ('Squash', 'Squash'),
    ('StairStepper', 'Stair Stepper'),
    ('StandUpPaddling', 'Stand-up Paddling'),
    ('Surfing', 'Surf'),
    ('Swim', 'Swim'),
    ('TableTennis', 'Table Tennis'),
    ('Tennis', 'Tennis'),
    ('Walk', 'Walk'),
    ('Snowshoe', 'Walk (Snowshoe)'),
    ('WeightTraining', 'Weight Training'),
    ('Wheelchair', 'Wheelchair'),
    ('Windsurf', 'Windsurf'),
    ('Yoga', 'Yoga'),
    ('Workout', 'Other Workout'),
]

# MET (Metabolic Equivalent) Source https://pacompendium.com/adult-compendium/
SPORT_MET = {
    'Badminton': {1: 5.0, 2: 5.5, 3: 7.0, 4: 9.0},
    'Basketball': {1: 6.0, 2: 8.0, 3: 9.3, 4: 11.0},
    'Boxing': {1: 7.8, 2: 9.5, 3: 12.8, 4: 13.4},
    'Ride': {1: 4.3, 2: 7.0, 3: 9.0, 4: 12.0},
    'EBikeRide': {1: 4.0, 2: 6.0, 3: 6.8, 4: 7.0},
    'GravelRide': {1: 4.3, 2: 7.0, 3: 9.0, 4: 12.0},
    'Handcycle': {1: 4.3, 2: 7.0, 3: 9.0, 4: 12.0},
    'Velomobile': {1: 4.3, 2: 7.0, 3: 9.0, 4: 12.0},
    'VirtualRide': {1: 4.3, 2: 7.0, 3: 9.0, 4: 12.0},
    'Canoeing': {1: 2.8, 2: 3.5, 3: 5.8, 4: 12.0},
    'Cricket': {1: 3.5, 2: 4.8, 3: 6.0, 4: 7.0},
    'Crossfit': {1: 3.5, 2: 5.0, 3: 6.0, 4: 7.5},
    'Dance': {1: 4.5, 2: 5.5, 3: 7.3, 4: 9.0},
    'Elliptical': {1: 3.0, 2: 5.0, 3: 7.0, 4: 9.0},
    'Golf': {1: 3.5, 2: 4.3, 3: 4.5, 4: 4.8},
    'HighIntensityIntervalTraining': {1: 5.0, 2: 7.0, 3: 9.0, 4: 11.0},
    'Hike': {1: 3.8, 2: 5.3, 3: 6.0, 4: 6.5},
    'IceSkate': {1: 7.5, 2: 9.8, 3: 12.3, 4: 15.5},
    'InlineSkate': {1: 7.5, 2: 9.8, 3: 12.3, 4: 15.5},
    'Kayaking': {1: 5.0, 2: 7.0, 3: 9.0, 4: 13.5},
    'Kickboxing': {1: 8.0, 2: 10.3, 3: 12.0, 4: 13.8},
    'Kitesurf': {1: 8.0, 2: 9.5, 3: 11.0, 4: 12.5},
    'MartialArts': {1: 5.3, 2: 7.4, 3: 10.3, 4: 12.0},
    'MountainBikeRide': {1: 7.0, 2: 9.0, 3: 11.0, 4: 14.0},
    'EMountainBikeRide': {1: 6.0, 2: 8.0, 3: 8.8, 4: 9.0},
    'MuayThai': {1: 8.0, 2: 10.3, 3: 12.0, 4: 13.8},
    'Padel': {1: 5.0, 2: 6.0, 3: 7.0, 4: 8.5},
    'Pickleball': {1: 5.0, 2: 5.5, 3: 7.0, 4: 9.0},
    'Pilates': {1: 1.8, 2: 2.8, 3: 4.0, 4: 5.5},
    'PhysicalTherapy': {1: 2.5, 2: 3.5, 3: 4.5, 4: 5.5},
    'Racquetball': {1: 5.5, 2: 7.0, 3: 8.5, 4: 10.0},
    'RockClimbing': {1: 5.8, 2: 7.3, 3: 8.8, 4: 10.5},
    'Rowing': {1: 5.0, 2: 7.5, 3: 11.0, 4: 14.0},
    'VirtualRow': {1: 5.0, 2: 7.5, 3: 11.0, 4: 14.0},
    'Run': {1: 7.8, 2: 10.5, 3: 11.8, 4: 13.0},
    'TrailRun': {1: 7.8, 2: 10.5, 3: 11.8, 4: 13.0},
    'VirtualRun': {1: 7.8, 2: 10.5, 3: 11.8, 4: 13.0},
    'Volleyball': {1: 3.0, 2: 4.0, 3: 6.0, 4: 8.0},
    'Sail': {1: 3.0, 2: 3.3, 3: 4.5, 4: 9.3},
    'Skateboard': {1: 5.0, 2: 6.0, 3: 6.8, 4: 8.5},
    'AlpineSki': {1: 4.3, 2: 6.3, 3: 7.3, 4: 8.0},
    'BackcountrySki': {1: 6.8, 2: 8.5, 3: 9.5, 4: 11.3},
    'NordicSki': {1: 8.5, 2: 11.3, 3: 13.5, 4: 14.0},
    'RollerSki': {1: 6.8, 2: 8.5, 3: 9.5, 4: 11.3},
    'Snowboard': {1: 4.3, 2: 6.3, 3: 7.5, 4: 8.0},
    'Soccer': {1: 3.5, 2: 5.5, 3: 7.0, 4: 9.5},
    'Squash': {1: 5.0, 2: 7.3, 3: 9.0, 4: 12.0},
    'StairStepper': {1: 5.5, 2: 6.0, 3: 8.0, 4: 11.0},
    'StandUpPaddling': {1: 2.8, 2: 3.8, 3: 5.0, 4: 9.8},
    'Surfing': {1: 3.0, 2: 5.0, 3: 7.0, 4: 9.0},
    'Swim': {1: 5.8, 2: 8.0, 3: 9.8, 4: 10.5},
    'TableTennis': {1: 3.5, 2: 4.0, 3: 5.5, 4: 7.0},
    'Tennis': {1: 5.0, 2: 6.0, 3: 6.8, 4: 8.0},
    'Walk': {1: 3.0, 2: 3.8, 3: 4.8, 4: 5.5},
    'Snowshoe': {1: 5.0, 2: 5.8, 3: 6.8, 4: 7.5},
    'WeightTraining': {1: 3.0, 2: 3.5, 3: 5.0, 4: 6.0},
    'Wheelchair': {1: 3.3, 2: 3.8, 3: 5.3, 4: 6.3},
    'Windsurf': {1: 5.0, 2: 7.0, 3: 11.0, 4: 14.0},
    'Workout': {1: 2.5, 2: 4.0, 3: 6.0, 4: 8.0},
    'Yoga': {1: 2.0, 2: 3.0, 3: 4.0, 4: 6.0},
}

INTENSITY_CATEGORIES = [
    (1, 'Easy (Could do another one later today)'),
    (2, 'Moderate (Done for today but tomorrow is a new day)'),
    (3, 'Hard (Will definitely feel this workout tomorrow)'),
    (4, "All Out (Can't do another one tomorrow)")
]


class Workout(models.Model):
    """Workout - user logged workout"""

    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, null=False, blank=False, primary_key=False)

    sport_type = models.CharField(null=False, max_length=40, choices=SPORT_TYPES)
    start_datetime = models.DateTimeField(null=False)
    duration = models.DurationField(null=False)
    intensity_category = models.IntegerField(null=True, choices=INTENSITY_CATEGORIES)
    kcal = models.DecimalField(null=True, max_digits=7, decimal_places=2)
    distance = models.DecimalField(null=True, max_digits=7, decimal_places=2)
    steps = models.IntegerField(null=True)

    strava_id = models.BigIntegerField(unique=True, null=True)
    strava_intensity_avg_watts = models.DecimalField(null=True, max_digits=7, decimal_places=2)

    garmin_id = models.CharField(max_length=40, unique=True, null=True)

    # Apple Health / Health Connect workout id (Open Wearables UUID).
    health_id = models.CharField(max_length=40, unique=True, null=True)

    @property
    def duration_seconds(self):
        return self.duration.seconds

    class Meta:
        indexes = [
            # Every workout save runs per-user date lookups (steps
            # dedup, recalc triggers) and the dashboards list workouts
            # per user ordered by time.
            models.Index(fields=["user", "start_datetime"], name="workout_user_time"),
        ]

    def __str__(self):
        """str print-out of model entry"""
        return f"{self.start_datetime} - {self.sport_type} ({self.duration / (1_000 * 60)} min / {self.kcal} kcal)"

    def __init__(self, *args, **kwargs):
        """ save initial field values to be able to detect changes """
        super().__init__(*args, **kwargs)
        self._original = self._dict()

    #@property
    def _dict(self):
        """ dict of current fields and values - to detect changes """
        return {f.name: round(float(self.__dict__[f.attname]), 2) if isinstance(self.__dict__.get(f.attname), (Decimal, float)) else self.__dict__.get(f.attname) for f in self._meta.fields}

    def get_changed_fields(self):
        """ check which fields have changed """
        current = self._dict()
        return {
            k: (v, current.get(k))
            for k, v in self._original.items()
            if v != current.get(k)
        }

    def save(self, *args, **kwargs):
        """Persist the row, then optionally score it.

        Scoring is a separate step (``score_workout``) so callers that
        only need to persist (tests of save-without-score, nested Steps
        recomputes) can pass ``score=False``. Default True so
        ``objects.create`` / import syncs still mint points.
        """
        do_score = kwargs.pop("score", True)
        is_create = self.pk is None
        scaling_kcal = float((1 if kwargs.get('user', None) is None else kwargs.get('user').scaling_kcal) if self.user is None else self.user.scaling_kcal)
        scaling_distance = float((1 if kwargs.get('user', None) is None else kwargs.get('user').scaling_distance) if self.user is None else self.user.scaling_distance)
        if self.sport_type == "Steps":
            self.intensity_category = 1

            # Subtract the steps from walks and runs from the daily total steps to not double count
            recorded_walks = Workout.objects.filter(user=self.user, start_datetime__date=self.start_datetime, sport_type='Walk').aggregate(duration=Sum('duration'))['duration']
            recorded_runs = Workout.objects.filter(user=self.user, start_datetime__date=self.start_datetime, sport_type='Run').aggregate(duration=Sum('duration'))['duration']
            recorded_steps_walks = 0 if recorded_walks is None else 6_000 / (60 * 60) * recorded_walks.seconds
            recorded_steps_runs = 0 if recorded_runs is None else 10_000 / (60 * 60) * recorded_runs.seconds
            self.distance = 0.82 * scaling_distance * max(self.steps - recorded_steps_walks - recorded_steps_runs, 0) / 1000
            base_duration_seconds = self.distance * (1 / scaling_distance) / 5 * 60 * 60
            self.duration = datetime.timedelta(seconds=base_duration_seconds)
            self.kcal = SPORT_MET["Walk"][self.intensity_category] * 75 * (base_duration_seconds / (60 * 60)) * scaling_kcal  # default human 75kg scaled up/down by scaler

            # update start_datetime to server 23:59:00 in UTC
            server_time = datetime.datetime.combine(self.start_datetime.date(), datetime.time(23, 59, 0))
            self.start_datetime = timezone.make_aware(server_time).astimezone(datetime.timezone.utc)

        if self.sport_type in ["Ride", "EBikeRide", "GravelRide", "Handcycle", "Velomobile", "VirtualRide", "MountainBikeRide", "EMountainBikeRide", "Run", "TrailRun", "VirtualRun", "Walk"]:
            # Estimate distance from MET only for manual entries. Imported
            # activities (Strava/Garmin/Health) already have GPS distance or
            # they don't - inventing ~2-3 km from duration for a 5k that
            # Health Connect shipped without metres is worse than blank.
            imported = bool(self.strava_id or self.garmin_id or self.health_id)
            if not imported and (self.distance is None or self.distance == ""):
                self.distance = SPORT_MET.get(self.sport_type, SPORT_MET['Workout'])[self.intensity_category] * (self.duration.seconds / (60 * 60)) * scaling_distance # default human 1000m scaled up/down by scaler

        # default intensity 2
        if self.intensity_category is None or self.intensity_category == "":
            self.intensity_category = 2

        # estimate kcal using database MET values
        if self.kcal is None or self.kcal == "":
            self.kcal = SPORT_MET.get(self.sport_type, SPORT_MET['Workout'])[self.intensity_category] * 75 * (self.duration.seconds / (60 * 60)) * scaling_kcal # default human 75kg scaled up/down by scaler

        super().save(*args, **kwargs)
        changed = self.get_changed_fields()
        if do_score:
            score_workout(self, new=is_create, changes=changed)
        self._original = self._dict()  # reset

        # if workout is run or walk and steps were recorded on the same day, update steps to avoid double counting
        if self.sport_type in ['Run', 'Walk']:
            # The keys of `changed` hold (old_value, new_value) tuples,
            # not the value itself. When start_datetime was edited we
            # need to also revisit the *old* day (in case a Steps row
            # was previously counted against the old date) - and the
            # *new* day (so it gets counted against the new date).
            target_dates = set()
            if 'start_datetime' in changed:
                old_dt, new_dt = changed['start_datetime']
                for dt in (old_dt, new_dt):
                    if isinstance(dt, str):
                        dt = datetime.datetime.fromisoformat(dt)
                    if dt is not None:
                        target_dates.add(dt.date())
            else:
                target_dates.add(self.start_datetime.date())
            recorded_steps = Workout.objects.filter(user=self.user, start_datetime__date__in=target_dates, sport_type='Steps')
            if len(recorded_steps) > 0:
                for steps in recorded_steps:
                    setattr(steps, 'distance', None)
                    setattr(steps, 'kcal', None)
                    steps.save(score=True)

    def delete(self, *args, **kwargs):
        """Drop points, then the row."""
        deleted_run_or_walk = self.sport_type in ['Run', 'Walk']
        unscore_workout(self)
        super().delete(*args, **kwargs)
        # if deleted workout was run or walk, update steps to give back counting
        if deleted_run_or_walk:
            recorded_steps = Workout.objects.filter(user=self.user, start_datetime__date=self.start_datetime, sport_type='Steps')
            if len(recorded_steps) > 0:
                for steps in recorded_steps:
                    setattr(steps, 'distance', None)
                    setattr(steps, 'kcal', None)
                    setattr(steps, 'duration', datetime.timedelta(seconds=0))
                    steps.save(score=True)


def find_duplicate_workout(user, start_datetime, duration, provider=None):
    """Cross-provider duplicate guard for sync imports.

    The same physical activity often exists in both ecosystems (recorded
    on a Garmin watch, auto-synced to Strava), and each sync only
    de-duplicates by its OWN provider id - so importing both providers
    (or re-importing after the user switched sources) would double every
    workout. This matches an existing workout of the same user by start
    time (±10 min) and duration (±5 min).

    Rows already carrying THIS provider's id are excluded: those are the
    provider's own duplicates (same activity re-uploaded) which the
    caller's id-based de-dup handles, not cross-provider copies.
    Manual entries (no provider id at all) DO count as duplicates - a
    manually logged workout must not be re-imported by a sync either.

    Returns the matching Workout or None.
    """
    if start_datetime is None or duration is None:
        return None
    qs = Workout.objects.filter(
        user=user,
        start_datetime__range=(
            start_datetime - datetime.timedelta(minutes=10),
            start_datetime + datetime.timedelta(minutes=10),
        ),
        duration__range=(
            duration - datetime.timedelta(minutes=5),
            duration + datetime.timedelta(minutes=5),
        ),
    )
    if provider == 'strava':
        qs = qs.filter(strava_id__isnull=True)
    elif provider == 'garmin':
        qs = qs.filter(garmin_id__isnull=True)
    elif provider == 'health':
        qs = qs.filter(health_id__isnull=True)
    return qs.order_by('start_datetime').first()
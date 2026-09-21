"""Canonical activity-type normalisation shared by ALL import sources.

Garmin, Health Connect / Apple HealthKit (via Open Wearables) and
Strava each ship their own activity-type vocabulary. Every sync must
land the same physical activity on the SAME ``Workout.sport_type``:
the Legend Echoes and the goal sport groups match on that exact
string, so a watch 'cardio' and an Apple 'CARDIO' session have to
become the identical app type or they fight over different Echoes.

One alias table for every provider - a new type is added here once and
all sources agree automatically.
"""

import re

from .models import SPORT_TYPES

_VALID_SPORT_TYPES = {key for key, _label in SPORT_TYPES}

# Provider spellings (normalised to lower_snake_case) -> app sport type.
SPORT_TYPE_ALIASES = {
    # ---- run ----------------------------------------------------------
    "running": "Run",
    "running_track": "Run",
    "track_running": "Run",
    "street_running": "Run",
    "obstacle_racing": "Run",  # Spartan/Tough Mudder is run-dominant
    "trail_running": "TrailRun",
    "running_treadmill": "VirtualRun",
    "treadmill": "VirtualRun",
    "treadmill_running": "VirtualRun",
    "indoor_running": "VirtualRun",
    # ---- bike ---------------------------------------------------------
    "cycling": "Ride",
    "biking": "Ride",
    "biking_road": "Ride",
    "gravel_cycling": "GravelRide",
    "mountain_biking": "MountainBikeRide",
    "e_bike": "EBikeRide",
    "ebike": "EBikeRide",
    "e_mountain_biking": "EMountainBikeRide",
    "indoor_cycling": "VirtualRide",
    "cycling_stationary": "VirtualRide",
    "spinning": "VirtualRide",
    "virtual_ride": "VirtualRide",
    "handcycle": "Handcycle",
    # ---- walk / hike ---------------------------------------------------
    "walking": "Walk",
    "walking_for_fitness": "Walk",
    "casual_walking": "Walk",
    "indoor_walking": "Walk",
    "hiking": "Hike",
    "snowshoeing": "Snowshoe",
    # ---- water ---------------------------------------------------------
    "swimming": "Swim",
    "swimming_pool": "Swim",
    "swimming_open_water": "Swim",
    "pool_swimming": "Swim",
    "open_water_swimming": "Swim",
    "rowing": "Rowing",
    "indoor_rowing": "VirtualRow",
    "rowing_machine": "VirtualRow",
    "kayaking": "Kayaking",
    "canoeing": "Canoeing",
    "paddleboarding": "StandUpPaddling",
    "stand_up_paddleboarding": "StandUpPaddling",
    "surfing": "Surfing",
    "windsurfing": "Windsurf",
    "kitesurfing": "Kitesurf",
    "sailing": "Sail",
    # ---- snow / ice / wheels ------------------------------------------
    "skiing": "AlpineSki",
    "skiing_downhill": "AlpineSki",
    "resort_skiing": "AlpineSki",
    "resort_skiing_snowboarding": "AlpineSki",
    "backcountry_skiing": "BackcountrySki",
    "skiing_cross_country": "NordicSki",
    "cross_country_skiing": "NordicSki",
    "skate_skiing": "NordicSki",
    "roller_skiing": "RollerSki",
    "snowboarding": "Snowboard",
    "ice_skating": "IceSkate",
    "inline_skating": "InlineSkate",
    "roller_skating": "InlineSkate",
    "skateboarding": "Skateboard",
    # ---- gym / cardio room ---------------------------------------------
    "elliptical": "Elliptical",
    "stair_climbing": "StairStepper",
    "stair_climbing_machine": "StairStepper",
    "stair_stepper": "StairStepper",
    # Watches/phones ship the plain "Cardio" profile under several keys.
    # Cardio room work lands in the HIIT bucket on every source.
    "cardio": "HighIntensityIntervalTraining",
    "indoor_cardio": "HighIntensityIntervalTraining",
    "hiit": "HighIntensityIntervalTraining",
    "high_intensity_interval_training": "HighIntensityIntervalTraining",
    "jump_rope": "HighIntensityIntervalTraining",
    "crossfit": "Crossfit",
    "cross_fit": "Crossfit",
    "strength_training": "WeightTraining",
    "traditional_strength_training": "WeightTraining",
    "functional_strength_training": "WeightTraining",
    "weightlifting": "WeightTraining",
    "pilates": "Pilates",
    "yoga": "Yoga",
    "rock_climbing": "RockClimbing",
    "bouldering": "RockClimbing",
    "climbing": "RockClimbing",
    "indoor_climbing": "RockClimbing",
    "physical_therapy": "PhysicalTherapy",
    "dance": "Dance",
    "dancing": "Dance",
    # ---- ball / racket --------------------------------------------------
    "soccer": "Soccer",
    "football": "Soccer",
    "squash": "Squash",
    "badminton": "Badminton",
    "tennis": "Tennis",
    "table_tennis": "TableTennis",
    "pickleball": "Pickleball",
    "padel": "Padel",
    "racquetball": "Racquetball",
    "golf": "Golf",
    "basketball": "Basketball",
    "volleyball": "Volleyball",
    "cricket": "Cricket",
    # ---- combat ----------------------------------------------------------
    "boxing": "Boxing",
    "kickboxing": "Kickboxing",
    "muay_thai": "MuayThai",
    "martial_arts": "MartialArts",
    "mixed_martial_arts": "MartialArts",
    "mma": "MartialArts",
    # ---- misc -------------------------------------------------------------
    "wheelchair": "Wheelchair",
    "wheelchair_walk_pace": "Wheelchair",
    "wheelchair_run_pace": "Wheelchair",
}


def normalize_sport_type(raw_type) -> tuple[str, bool]:
    """Provider activity type -> (app ``Workout.sport_type``, matched?).

    Normalises camelCase / UPPER_SNAKE / dashes / the Health Connect
    ``EXERCISE_TYPE_*`` prefix, then consults the shared alias table.
    Strings that already ARE one of our sport types pass through
    (Strava ships our vocabulary). Anything unknown falls back to the
    generic 'Workout' bucket - ``matched`` is False so callers can log
    the miss instead of silently degrading (the 'cardio' gap went
    unnoticed for months exactly because the fallback was silent).
    """
    if raw_type in _VALID_SPORT_TYPES:
        return raw_type, True
    key = str(raw_type or "").strip()
    key = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key)  # camelCase -> snake_case
    key = key.lower().replace(" ", "_").replace("-", "_")
    if key.startswith("exercise_type_"):
        key = key[len("exercise_type_"):]
    mapped = SPORT_TYPE_ALIASES.get(key)
    if mapped:
        return mapped, True
    return "Workout", False

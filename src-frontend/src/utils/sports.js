import {Bike, Dumbbell, Flame, Flower2, Footprints, Mountain, Waves, Zap} from "lucide-react";
import {statsApi} from "./reducers/statsSlice";
import {feedApi} from "./reducers/feedSlice";

// After a workout save the challenge page must catch up without a manual
// refresh: feed/stats are invalidated immediately, and the server's
// capped-points recalculation is async (~10s later, throttled to 30s),
// so two delayed re-invalidations pick up the final numbers instead of
// waiting for the 90s poll. The stats endpoint busts its own cache on
// these changes, so every refetch here is actually fresh.
export function refreshChallengeSoon(dispatch) {
    const invalidateStatsAndFeed = () => {
        dispatch(statsApi.util.invalidateTags(['Stats']));
        dispatch(feedApi.util.invalidateTags(['Feed']));
    };
    setTimeout(invalidateStatsAndFeed, 15000);
    setTimeout(() => dispatch(statsApi.util.invalidateTags(['Stats'])), 35000);
}

export const workoutTypes = {
    "Steps": {"label": "Total Daily Steps", "label_short": "Steps"},
    "Badminton": {"label": "Badminton", "label_short": "Badminton"},
    "Basketball": {"label": "Basketball", "label_short": "Basketball"},
    "Boxing": {"label": "Boxing", "label_short": "Boxing"},
    "Ride": {"label": "Biking/Cycling", "label_short": "Cycling"},
    "EBikeRide": {"label": "Biking/Cycling (E-Bike)", "label_short": "Cycling"},
    "GravelRide": {"label": "Biking/Cycling (Gravel)", "label_short": "Cycling"},
    "Handcycle": {"label": "Biking/Cycling (Handcycle)", "label_short": "Cycling"},
    "Velomobile": {"label": "Biking/Cycling (Velomobile)", "label_short": "Cycling"},
    "VirtualRide": {"label": "Biking/Cycling (Virtual)", "label_short": "Cycling"},
    "Canoeing": {"label": "Canoe", "label_short": "Canoe"},
    "Cricket": {"label": "Cricket", "label_short": "Cricket"},
    "Crossfit": {"label": "Crossfit", "label_short": "Crossfit"},
    "Dance": {"label": "Dance", "label_short": "Dance"},
    "Elliptical": {"label": "Elliptical", "label_short": "Elliptical"},
    "Golf": {"label": "Golf", "label_short": "Golf"},
    "HighIntensityIntervalTraining": {"label": "High Intensity Interval Training (HIIT)", "label_short": "HIIT"},
    "Hike": {"label": "Hike", "label_short": "Hike"},
    "IceSkate": {"label": "Ice Skate", "label_short": "Ice Skate"},
    "InlineSkate": {"label": "Inline Skate", "label_short": "Inline Skate"},
    "Kayaking": {"label": "Kayak", "label_short": "Kayak"},
    "Kickboxing": {"label": "Kickboxing", "label_short": "Kickboxing"},
    "Kitesurf": {"label": "Kitesurf", "label_short": "Kitesurf"},
    "MartialArts": {"label": "Martial Arts", "label_short": "Martial Arts"},
    "MountainBikeRide": {"label": "Mountain-Biking/Cycling", "label_short": "Mountain-Biking"},
    "EMountainBikeRide": {"label": "Mountain-Biking/Cycling (E-Bike)", "label_short": "Mountain-Biking"},
    "MuayThai": {"label": "Muay Thai", "label_short": "Muay Thai"},
    "Padel": {"label": "Padel", "label_short": "Padel"},
    "Pickleball": {"label": "Pickleball", "label_short": "Pickleball"},
    "Pilates": {"label": "Pilates", "label_short": "Pilates"},
    "PhysicalTherapy": {"label": "Physical Therapy", "label_short": "Physio"},
    "Racquetball": {"label": "Racquetball", "label_short": "Racquetball"},
    "RockClimbing": {"label": "Rock Climbing", "label_short": "Climbing"},
    "Rowing": {"label": "Rowing (Outdoor)", "label_short": "Rowing"},
    "VirtualRow": {"label": "Rowing (Virtual)", "label_short": "Rowing"},
    "Run": {"label": "Run", "label_short": "Run"},
    "TrailRun": {"label": "Run (Trail)", "label_short": "Run"},
    "VirtualRun": {"label": "Run (Treadmill / Virtual)", "label_short": "Run"},
    "Volleyball": {"label": "Volleyball", "label_short": "Volleyball"},
    "Sail": {"label": "Sail", "label_short": "Sail"},
    "Skateboard": {"label": "Skateboard", "label_short": "Skateboard"},
    "AlpineSki": {"label": "Ski (Alpine)", "label_short": "Ski"},
    "BackcountrySki": {"label": "Ski (Backcountry)", "label_short": "Ski"},
    "NordicSki": {"label": "Ski (Nordic)", "label_short": "Ski"},
    "RollerSki": {"label": "Ski (Roller/Inliner)", "label_short": "Ski"},
    "Snowboard": {"label": "Snowboard", "label_short": "Snowboard"},
    "Soccer": {"label": "Soccer / Football", "label_short": "Soccer"},
    "Squash": {"label": "Squash", "label_short": "Squash"},
    "StairStepper": {"label": "Stair Stepper", "label_short": "Stepper"},
    "StandUpPaddling": {"label": "Stand-up Paddling", "label_short": "SUP"},
    "Surfing": {"label": "Surf", "label_short": "Surf"},
    "Swim": {"label": "Swim", "label_short": "Swim"},
    "TableTennis": {"label": "Table Tennis", "label_short": "Table Tennis"},
    "Tennis": {"label": "Tennis", "label_short": "Tennis"},
    "Walk": {"label": "Walk", "label_short": "Walk"},
    "Snowshoe": {"label": "Walk (Snowshoe)", "label_short": "Walk"},
    "WeightTraining": {"label": "Weight Training", "label_short": "Weights"},
    "Wheelchair": {"label": "Wheelchair", "label_short": "Wheelchair"},
    "Windsurf": {"label": "Windsurf", "label_short": "Windsurf"},
    "Yoga": {"label": "Yoga", "label_short": "Yoga"},
    "Workout": {"label": "Other Workout", "label_short": "Other"}
}

// Safe display label for ANY sport type. The DB can contain sport types
// this map doesn't know (Strava still adds new ones) so a direct
// `workoutTypes[type].label_short` lookup must not throw. Unknown types
// fall back to their raw name, then to "Other".
export function sportLabelShort(sportType) {
    return workoutTypes[sportType]?.label_short ?? sportType ?? "Other";
}

const SPORT_ICONS = {
    Run: Footprints, TrailRun: Footprints, VirtualRun: Footprints, Walk: Footprints, Hike: Mountain, Steps: Footprints,
    Ride: Bike, EBikeRide: Bike, GravelRide: Bike, MountainBikeRide: Bike, EMountainBikeRide: Bike, VirtualRide: Bike,
    Swim: Waves, Rowing: Waves, VirtualRow: Waves, Kayaking: Waves, Canoeing: Waves, StandUpPaddling: Waves, Surfing: Waves,
    WeightTraining: Dumbbell, Crossfit: Dumbbell, HighIntensityIntervalTraining: Flame, Yoga: Flower2, Pilates: Flower2,
};

export function sportIcon(sportType) {
    return SPORT_ICONS[sportType] || Zap;
}

import {
    useAddWorkoutMutation,
    useDeleteWorkoutMutation, useGetWorkoutByIdQuery,
    useUpdateWorkoutMutation
} from "../utils/reducers/workoutsSlice";
import React, {useEffect, useState} from "react";
import {AddButton, DeleteButton, Modal, SaveButton, SingleForm, useFormDirty} from "./basicComponents";
import {statsApi} from "../utils/reducers/statsSlice";
import {feedApi} from "../utils/reducers/feedSlice";
import {useDispatch} from "react-redux";
import {clearBodyScrollLock} from "../utils/overlay";
import {confirmAction} from "../utils/dialogs";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";

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


const fields = {

    "sport_type": {
        "type": "select",
        "required": true,
        "read_only": false,
        "label": "Sport type",
        "value": "Run",
        "width": "max-sm:w-full w-1/2",
        "autoFocus": true,
        "selectList": Object.entries(workoutTypes).map(([key, value]) => ({
          value: key,
          ...value
        }))
    },
    "start_datetime": {
        "type": "datetime-local",
        "required": true,
        "read_only": false,
        "label": "Start Date & Time",
        "width": "max-sm:w-full w-1/2",
    },
    "duration": {
        "type": "duration",
        "required": true,
        "read_only": false,
        "label": "Duration (hh:mm[:ss])",
        "width": "max-sm:w-full w-1/2",
    },
    "intensity_category": {
        "type": "select",
        "required": false,
        "read_only": false,
        "label": "Intensity",
        "value": 2,
        "width": "max-sm:w-full w-1/2",
        "selectList": [
            {
                "value": 1,
                "label": "Easy (Could do another one later today)"
            },
            {
                "value": 2,
                "label": "Moderate (Done for today but tomorrow is a new day)"
            },
            {
                "value": 3,
                "label": "Hard (Will definitely feel this workout tomorrow)"
            },
            {
                "value": 4,
                "label": "All Out (Can't do another one tomorrow)"
            }
        ]
    },
    "kcal": {
        "type": "decimal",
        "required": false,
        "read_only": false,
        "label": "Kcal",
        "max_digits": 7,
        "decimal_places": 2,
        "width": "max-sm:w-full w-1/2",
        "placeholder": "Estimated if left empty"
    },
    "distance": {
        "type": "decimal",
        "required": false,
        "read_only": false,
        "label": "Distance (km)",
        "max_digits": 7,
        "decimal_places": 2,
        "width": "max-sm:w-full w-1/2",
        "placeholder": "Only if applicable"
    }

}


const steps_fields = {

    "sport_type": fields["sport_type"],

    "start_date": {
        "type": "date",
        "required": true,
        "read_only": false,
        "label": "Date",
        "width": "max-sm:w-full w-1/2",
    },
    "steps": {
        "type": "number",
        "required": true,
        "read_only": false,
        "label": "Total Daily Steps",
        "width": "max-sm:w-full w-1/2",
        "placeholder": "Number of total steps"
    },

}




export default function WorkoutForm({id = true, setModalState, scaling_distance}) {
    const dispatch = useDispatch();

    // Local date, not toISOString() (UTC): near midnight the UTC date is
    // already tomorrow and the form would prefill the day before yesterday.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pad2 = (n) => String(n).padStart(2, "0");
    const yesterdayString = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(yesterday.getDate())}`;
    // "Log a workout" opens a real workout (Run) - not the Steps form,
    // which is for the daily-step totals that sync automatically.
    const defaultValues = {
        "sport_type": "Run",
        "start_date": yesterdayString.substring(0, 10),
        "start_datetime": yesterdayString.substring(0, 10) + "T20:00",
        "duration": "00:30:00",
        "intensity_category": 1,
    };

    const [values, setValues] = useState({...defaultValues});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    // The "new workout" variants open the form without an id (or with
    // boolean true) - skip the fetch or it fires GET /api/workout/undefined/,
    // which 404s and (repeated) looks like path probing to fail2ban/CrowdSec.
    const {
        data: initWorkout,
        error: initError,
        isLoading: iniLoading
    } = useGetWorkoutByIdQuery(id, {skip: typeof id !== 'number'});
    const [updateEntry, {
        error: updateError,
        isLoading: updateIsLoading,
    }] = useUpdateWorkoutMutation();
    const [createEntry, {
        error: createError,
        isLoading: createIsLoading,
    }] = useAddWorkoutMutation();
    const [deleteEntry, {
        error: deleteError,
        isLoading: deleteIsLoading,
    }] = useDeleteWorkoutMutation();

    // Overall form error message - human sentences, never raw status
    // codes or server HTML.
    useEffect(() => {
        if (initError !== undefined) {
            setFormError(errText(initError, "Could not load this workout. Close and try again."));
        } else if (updateError !== undefined) {
            setFormError(errText(updateError, "Could not save the workout. Please try again."));
        } else if (createError !== undefined) {
            setFormError(errText(createError, "Could not save the workout. Please try again."));
        } else if (deleteError !== undefined) {
            setFormError(errText(deleteError, "Could not delete the workout. Please try again."));
        }
    }, [initError, updateError, createError, deleteError])

    // load current form values - and snapshot them for the dirty guard
    const [initialValues, setInitialValues] = useState({...defaultValues});
    useEffect(() => {
        if (initWorkout !== undefined) {
            const loaded = {...initWorkout, start_date: initWorkout.start_datetime.substring(0, 10)};
            setValues(loaded);
            setInitialValues(loaded);
        }
    }, [initWorkout])

    // form action button left
    async function handleDiscard() {
        if (id !== true) {
            // delete workout - destructive and points are recalculated,
            // so confirm first. (Challenge/account deletes already do.)
            const confirmed = await confirmAction(
                "Delete this workout? Its points are removed from every challenge. This cannot be undone.");
            if (!confirmed) return;
            try {
                await deleteEntry(values.id).unwrap();
                setModalState(false);
                clearBodyScrollLock();
            } catch (err) {
                // Surface the failure - this used to only console.error.
                console.error('Delete Workout failed', err);
                setFormError(errText(err, "Could not delete the workout. Please try again."));
                return;
            }
        } else {
            // save and add another
            try {
                let tmpValues = {...values};
                if (tmpValues.sport_type === "Steps") {
                    tmpValues.start_datetime = tmpValues.start_date + "T23:59";
                } else {
                    tmpValues.steps = null;
                }
                if ((tmpValues.duration || "").length === 5) {
                    tmpValues.duration += ":00";
                }
                await createEntry(tmpValues).unwrap();
                setValues({...defaultValues});
                toast.success("Workout saved - ready for the next one.");
            } catch (err) {
                console.error('Create Workout failed', err);
                setFieldErrors(err.data);
            }
        }
        dispatch(statsApi.util.invalidateTags(['Stats']));
        dispatch(feedApi.util.invalidateTags(['Feed']));
        refreshChallengeSoon(dispatch);
    }

    // form action button right
    async function handleSubmit() {
        let tmpValues = {...values};
        if (tmpValues.sport_type === "Steps") {
            tmpValues.start_datetime = tmpValues.start_date + "T23:59";
        } else {
            tmpValues.steps = null;
        }
        if ((tmpValues.duration || "").length === 5) {
            tmpValues.duration += ":00";
        }
        if (id !== true) {
            // update workout
            try {
                await updateEntry(tmpValues).unwrap();
                setModalState(false);
                clearBodyScrollLock();
                toast.success("Workout updated.");
            } catch (err) {
                console.error('Update Workout failed', err);
                setFieldErrors(err.data);
            }
        } else {
            // create workout
            try {
                await createEntry(tmpValues).unwrap();
                setModalState(false);
                clearBodyScrollLock();
                toast.success("Workout logged. Points recalculate in the background.");
            } catch (err) {
                console.error('Create Workout failed', err);
                setFieldErrors(err.data);
            }
        }
        dispatch(statsApi.util.invalidateTags(['Stats']));
        dispatch(feedApi.util.invalidateTags(['Feed']));
        refreshChallengeSoon(dispatch);
    }

    const [activeFields, setActiveFields] = useState(fields);

    // if workout type is walk, add additional field "steps" for people to estimate time and distance
    useEffect(() => {
        if (values.sport_type === "Steps") {
            setActiveFields(steps_fields);
        } else {
            setActiveFields(fields);
        }
    }, [values.sport_type])

    const dirty = useFormDirty(values, initialValues);

    return (
        <Modal title="Workout" landscape={true} setShowModal={setModalState}
               isLoading={iniLoading || updateIsLoading || createIsLoading || deleteIsLoading}
               confirmDiscard={dirty}>
            <SingleForm fields={activeFields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-danger-text text-xs italic">{formError}</div>
            {(id !== true && values.sport_type !== "Steps" && (values?.strava_id === null || values?.strava_id === '')) ? <div className="text-center text-orange-500 text-xs italic"><b>Note:</b> Empty the kcal field to re-calculate after changes to the workout type, duration, or intensity.</div> : null}
            <div className="relative flex justify-between items-center">
                {
                    (id !== true) ? (
                        <DeleteButton onClick={handleDiscard} label="Delete" highlighted={false} larger={true}
                                      additionalClasses=" text-red-600 dark:text-red-400 "/>
                    ) : (
                        <AddButton additionalClasses=" hover:text-green-800 " onClick={handleDiscard} label="Save and add another" highlighted={false} larger={true}/>
                    )
                }
                <SaveButton onClick={handleSubmit} label={(id !== true) ? "Update" : "Save"} highlighted={true} larger={true}/>
            </div>
        </Modal>
    )
}
import {
    useAddWorkoutMutation,
    useDeleteWorkoutMutation, useGetWorkoutByIdQuery,
    useGetWorkoutSummaryQuery,
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

import {refreshChallengeSoon, workoutTypes, sportLabelShort} from "../utils/sports";
import {DeltaChip, StatTile} from "../components/polishBits";
export {refreshChallengeSoon, workoutTypes, sportLabelShort};
import QuickLogSheet from "./quickLog";


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




function durationSeconds(value) {
    const parts = String(value || "").split(":").map((part) => Number(part));
    if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatPace(secondsPerKm) {
    if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return null;
    const mins = Math.floor(secondsPerKm / 60);
    const secs = Math.round(secondsPerKm % 60) % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

function WorkoutStatStrip({values, summary}) {
    if (!values?.sport_type) return null;
    if (values.sport_type === "Steps") {
        return (
            <div className="mb-3 grid grid-cols-2 gap-2">
                <StatTile label="Steps" value={Number(values.steps || 0).toLocaleString()} primary/>
            </div>
        );
    }
    const seconds = durationSeconds(values.duration);
    const km = Number(values.distance) || 0;
    const kcal = Number(values.kcal) || 0;
    const workouts = Number(summary?.d30?.workouts) || 0;
    const avgKm = workouts > 0 ? Number(summary.d30.distance) / workouts : null;
    const avgKcal = workouts > 0 ? Number(summary.d30.kcal) / workouts : null;
    const avgMin = workouts > 0 ? Number(summary.d30.seconds) / workouts / 60 : null;
    const pace = km > 0 && seconds > 0 ? formatPace(seconds / km) : null;
    const distanceFirst = km > 0;
    return (
        <div className="mb-3 grid grid-cols-2 gap-2">
            <StatTile label="Time" value={values.duration ? String(values.duration).slice(0, 5) : "–"} primary={!distanceFirst}
                      delta={!distanceFirst ? <DeltaChip current={seconds / 60} average={avgMin} unit="min"/> : null}/>
            <StatTile label="Distance" value={km ? String(Math.round(km * 10) / 10) : "–"} unit={km ? "km" : undefined} primary={distanceFirst}
                      delta={distanceFirst ? <DeltaChip current={km} average={avgKm} unit="km"/> : null}/>
            <StatTile label="Calories" value={kcal ? Math.round(kcal).toLocaleString() : "–"}
                      delta={<DeltaChip current={kcal} average={avgKcal} unit="kcal" digits={0}/>}/>
            <StatTile label="Pace" value={pace || "–"} unit={pace ? "/km" : undefined}/>
        </div>
    );
}

export default function WorkoutForm({id = true, setModalState, scaling_distance, preface = null}) {
    if (id === true) return <QuickLogSheet setModalState={setModalState}/>;
    return <WorkoutEditForm id={id} setModalState={setModalState} scaling_distance={scaling_distance} preface={preface}/>;
}

function WorkoutEditForm({id, setModalState, preface = null}) {
    const dispatch = useDispatch();
    const {data: workoutSummary} = useGetWorkoutSummaryQuery();

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
            {preface}
            <WorkoutStatStrip values={values} summary={workoutSummary}/>
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
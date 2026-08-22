import React, {useEffect, useState} from "react";
import {useDispatch} from "react-redux";
import {Modal, MultiForm, SaveButton, DeleteButton} from "./basicComponents";
import lodFilter from 'lodash/filter';
import {
    useAddGoalMutation,
    useDeleteGoalMutation,
    useGetGoalsQuery,
    useUpdateGoalMutation
} from "../utils/reducers/goalsSlice";
import {compareDictLists} from "../utils/miscellaneous";
import {refreshChallengeSoon} from "./workoutForm";
import {confirmAction, notice} from "../utils/dialogs";

const fields = {

    "name": {
        "type": "text",
        "required": true,
        "read_only": false,
        "label": "Goal Name",
        "value": "Move Goal",
    },

    "goal": {
        "type": "number",
        "required": true,
        "read_only": false,
        "value": "1200",
        "label": "Goal",
        "width": "w-1/3",
    },

    "metric": {
        "type": "select",
        "required": true,
        "read_only": false,
        "label": "Metric",
        "value": "kcal",
        "width": "w-1/3",
        "selectList": [
            {
                "value": "min",
                "label": "Time (Minutes)"
            },
            {
                "value": "num",
                "label": "Number of times (x)"
            },
            {
                "value": "kcal",
                "label": "Calories (Kcal)"
            },
            {
                "value": "km",
                "label": "Distance (Km)"
            },
            {
                "value": "kj",
                "label": "Effort (Kilojoules)"
            }
        ]
    },

    "period": {
        "type": "select",
        "required": true,
        "read_only": false,
        "label": "Period",
        "value": "week",
        "width": "w-1/3",
        "selectList": [
            {
                "value": "day",
                "label": "per day"
            },
            {
                "value": "week",
                "label": "per week"
            },
            {
                "value": "month",
                "label": "per month"
            },
            {
                "value": "competition",
                "label": "during the competition"
            }
        ]
    },

    "min_per_workout": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Minimum per workout",
        "placeholder": "Leave empty to not floor",
        "width": "w-1/2",
    },

    "max_per_workout": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Maximum per workout",
        "placeholder": "Leave empty to not cap",
        "width": "w-1/2",
    },

    "min_per_day": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Minimum per day",
        "placeholder": "Leave empty to not floor",
        "width": "w-1/2",
    },

    "max_per_day": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Maximum per day",
        "placeholder": "Leave empty to not cap",
        "value": "750",
        "width": "w-1/2",
    },

    "min_per_week": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Minimum per week",
        "placeholder": "Leave empty to not floor",
        "width": "w-1/2",
    },

    "max_per_week": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Maximum per week",
        "placeholder": "Leave empty to not cap",
        "value": "3600",
        "width": "w-1/2",
    },

    "count_steps_as_walks": {
        "type": "checkbox",
        "required": false,
        "read_only": false,
        "label": "Count steps as walks (double counting is taken care of but manual steps entry required)",
        "value": false,
        "width": "w-full",
    },

}


export default function ActivityGoalsForm({competitionId, setModalState}) {

    const dispatch = useDispatch();
    const {
        data: goals,
        isLoading: goalsLoading,
        isSuccess: goalsIsSuccess,
        refetch: refetchGoals,
    } = useGetGoalsQuery();
    const [updateGoal, {
        isLoading: updateGoalIsLoading,
    }] = useUpdateGoalMutation();
    const [createGoal, {
        isLoading: createGoalIsLoading,
    }] = useAddGoalMutation();
    const [deleteGoal, {
        isLoading: deleteGoalIsLoading,
    }] = useDeleteGoalMutation();
    const filteredGoals = lodFilter(goals || [], item => item?.competition == competitionId).map((item, index) => ({ ...item, index }));

    const [values, setValues] = useState(undefined);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    // Optional numeric fields arrive as "" when the user clears them -
    // DRF rejects "" with a 400. Coerce to null (and numbers to numbers).
    function sanitizePayload(item) {
        const out = {...item};
        for (const key of ['goal', 'min_per_workout', 'max_per_workout', 'min_per_day', 'max_per_day', 'min_per_week', 'max_per_week']) {
            if (out[key] === '' || out[key] === undefined) {
                out[key] = null;
            } else if (out[key] !== null && typeof out[key] !== 'number') {
                out[key] = parseFloat(out[key]);
            }
        }
        return out;
    }

    async function handleSubmit() {
        setFieldErrors({});
        setFormError('');
        let noErrors = true;
        const { newEntries, deletedEntries, changedEntries } = compareDictLists(filteredGoals, values);
        for (const newItem of newEntries) {
            const result = await createGoal({...sanitizePayload(newItem), competition: competitionId});
            if (result.hasOwnProperty('error')) {
                noErrors = false;
                console.error('Create Goal Error', result.error);
                setFormError(prev => prev + 'Error (' + result?.error?.status + ') when creating goal "' + newItem?.name + '": ' + result?.error?.data?.detail + '; ');
            }
        }
        for (const deletedItem of deletedEntries) {
            const result = await deleteGoal(deletedItem.id);
            if (result.hasOwnProperty('error')) {
                noErrors = false;
                console.error('Delete Goal Error', result.error);
                setFormError(prev => prev + 'Error (' + result?.error?.status + ') when deleting goal "' + deletedItem?.name + '" (' + deletedItem?.id + '): ' + result?.error?.data?.detail + '; ');
            }
        }
        for (const changedItem of changedEntries) {
            const result = await updateGoal({id: changedItem.id, ...sanitizePayload(Object.fromEntries(Object.entries(changedItem.changes).map(([key, value]) => [key, value.to])))});
            if (result.hasOwnProperty('error')) {
                noErrors = false;
                console.error('Update Goal Error', result.error);
                setFieldErrors(prev => ({...prev, [`${changedItem.index}`]: result.error.data}));
            }
        }
        if (noErrors) {
            // Pull the challenge page's data sources now (and again after
            // the server's async cap recalc lands, ~10-30s) instead of
            // waiting for the 90s poll - same pattern as workout edits.
            refreshChallengeSoon(dispatch);
            document.body.classList.remove('body-no-scroll');
            setModalState(false);
            await notice('Saved. Points are being recalculated - the challenge page updates itself within a minute.');
        } else {
            // Partial failure: rows created above now exist server-side
            // but their local copies still have no id - a retry would
            // diff them as "new" and create duplicates. Re-sync the form
            // from the server state before the user can retry.
            const fresh = await refetchGoals();
            if (fresh.data) {
                setValues([...lodFilter(fresh.data, item => item?.competition == competitionId).map(item => ({...item}))]);
            }
        }
    }

    function handleDiscard() {
        setModalState(false);
        setValues([...filteredGoals.map(item => ({ ...item }))]);
    }

    useEffect(() => {
        if (goalsIsSuccess && values === undefined && filteredGoals) {
            setValues([...filteredGoals.map(item => ({ ...item }))]);
        }
    }, [goalsIsSuccess]);


    return (
        <Modal title="Activity Goals" landscape={false} setShowModal={setModalState} isLoading={goalsLoading || createGoalIsLoading || deleteGoalIsLoading ||updateGoalIsLoading}>
            <MultiForm fields={fields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-red-500 text-xs italic">{formError}</div>
            <div className="relative flex justify-between items-center">
              <DeleteButton onClick={handleDiscard} highlighted={false} label={"Discard Changes"} larger={true} />
              <SaveButton onClick={handleSubmit} highlighted={true} larger={true} />
            </div>
        </Modal>
    )
}



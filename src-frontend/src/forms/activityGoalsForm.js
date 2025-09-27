import React, {use, useEffect, useState} from "react";
import {Modal, MultiForm, SaveButton, DeleteButton, PlaceholderModal} from "./basicComponents";
import {useAddTeamMutation, useDeleteTeamMutation, useGetTeamsQuery} from "../utils/reducers/teamsSlice";
import _ from "lodash";
import {
    useAddGoalMutation,
    useDeleteGoalMutation,
    useGetGoalsQuery,
    useUpdateGoalMutation
} from "../utils/reducers/goalsSlice";
import {BarLoader, BeatLoader} from "react-spinners";
import {deepDiff, compareDictLists} from "../utils/miscellaneous";
import {useDispatch} from "react-redux";

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

    const {
        data: goals,
        refetch: goalsRefetch,
        error: goalsError,
        isLoading: goalsLoading,
        isSuccess: goalsIsSuccess,
        isFetching: goalsIsFetching,
    } = useGetGoalsQuery();
    const [updateGoal, {
        data: updateGoalData,
        error: updateGoalError,
        isLoading: updateGoalIsLoading,
        isSuccess: updateGoalIsSuccess
    }] = useUpdateGoalMutation();
    const [createGoal, {
        data: createGoalData,
        error: createGoalError,
        isLoading: createGoalIsLoading,
        isSuccess: createGoalIsSuccess
    }] = useAddGoalMutation();
    const [deleteGoal, {
        error: deleteGoalError,
        isLoading: deleteGoalIsLoading,
        isSuccess: deleteGoalIsSuccess
    }] = useDeleteGoalMutation();
    const filteredGoals = _.filter(goals || [], item => item?.competition == competitionId).map((item, index) => ({ ...item, index }));

    const [values, setValues] = useState(undefined);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    async function handleSubmit() {
        setFieldErrors({});
        setFormError('');
        let noErrors = true;
        const { newEntries, deletedEntries, changedEntries } = compareDictLists(filteredGoals, values);
        for (const newItem of newEntries) {
            const result = await createGoal({...newItem, competition: competitionId});
            if (result.hasOwnProperty('error')) {
                noErrors = false;
                console.error('Create Goal Error', result.error);
                setFormError(formError + 'Error (' + result?.error?.status + ') when creating goal "' + newItem?.name + '": ' + result?.error?.data?.detail + '; ');
            } else {
                console.log('Added Goal', newItem, result);
            }
        }
        for (const deletedItem of deletedEntries) {
            const result = await deleteGoal(deletedItem.id);
            if (result.hasOwnProperty('error')) {
                noErrors = false;
                console.error('Delete Goal Error', result.error);
                setFormError(formError + 'Error (' + result?.error?.status + ') when deleting goal "' + deletedItem?.name + '" (' + deletedItem?.id + '): ' + result?.error?.data?.detail + '; ');
            } else {
                console.log('Deleted Goal', deletedItem, result);
            }
        }
        for (const changedItem of changedEntries) {
            const result = await updateGoal({id: changedItem.id, ...Object.fromEntries(Object.entries(changedItem.changes).map(([key, value]) => [key, value.to]))});
            if (result.hasOwnProperty('error')) {
                noErrors = false;
                console.error('Update Goal Error', result.error);
                setFieldErrors({...fieldErrors, [`${changedItem.index}`]: result.error.data});
            } else {
                console.log('Changed Goal', changedItem, result);
            }
        }
        if (noErrors) {
            document.body.classList.remove('body-no-scroll');
            setModalState(false);
            window.alert('Saved. The points might need to be re-calculated. Thus changes can take up to 10 minutes to reflect on the competition page for all users.');
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



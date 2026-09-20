import React, {useEffect, useState} from "react";
import {useUpdateUserMutation} from "../utils/reducers/usersSlice";
import {Modal, SaveButton, SingleForm} from "./basicComponents";
import {clearBodyScrollLock} from "../utils/overlay";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";

const fields = {

    "goal_active_days": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Active days per week",
        "placeholder": "Leave empty for no goal",
        "width": "max-sm:w-full w-1/3",
    },

    "goal_workout_minutes": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Workout minutes per week",
        "placeholder": "Leave empty for no goal",
        "width": "max-sm:w-full w-1/3",
    },

    "goal_distance": {
        "type": "number",
        "required": false,
        "read_only": false,
        "label": "Distance per week (km)",
        "placeholder": "Leave empty for no goal",
        "width": "max-sm:w-full w-1/3",
    },

}



export default function PersonalGoalsForm({user, setModalState}) {

    const [values, setValues] = useState({});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    const [updateEntry, {
        error: updateError,
        isLoading: updateIsLoading,
    }] = useUpdateUserMutation();

    // Overall form error message - human sentence, never status soup.
    useEffect(() => {
        if (updateError !== undefined) {
            setFormError(errText(updateError, "Could not save your goals. Please try again."));
        }
    }, [updateError])

    // load current form values
    useEffect(() => {
        if (user !== undefined) {
            setValues({goal_active_days: user.goal_active_days, goal_workout_minutes: user.goal_workout_minutes, goal_distance: user.goal_distance});
        }
    }, [])

    // form action button right
    async function handleSubmit() {
        // update personal goals
        try {
            const cleanedValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === "" ? null : value])); // replace empty strings with null
            await updateEntry({id: 'me', ...cleanedValues}).unwrap();
            setModalState(false);
            clearBodyScrollLock();
            toast.success("Goals saved.");
        } catch (err) {
            console.error('Update Personal Goals failed', err);
            setFieldErrors(err?.data || {});
        }
    }

    return (
        <Modal title="Personal Goals" landscape={true} setShowModal={setModalState} isLoading={updateIsLoading}>
            <SingleForm fields={fields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-danger-text text-xs italic">{formError}</div>
            <div className="text-xs text-center italic text-gray-500"><b>Note:</b> These personal goals are only visible to you and do not affect any challenge you're in.</div>
            <div className="relative flex justify-end items-end">
                <SaveButton onClick={handleSubmit} label="Update" highlighted={true} larger={true} />
            </div>
        </Modal>
    )
}
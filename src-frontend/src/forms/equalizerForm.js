import {useUpdateUserMutation} from "../utils/reducers/usersSlice";
import React, {useEffect, useState} from "react";
import {Modal, SaveButton, SingleForm} from "./basicComponents";


const fields = {

    "gender": {
        "type": "select",
        "required": false,
        "read_only": false,
        "label": "Gender",
        "width": "max-sm:w-full w-2/3",
        "selectList": [
            {
                "value": "M",
                "label": "Male"
            },
            {
                "value": "F",
                "label": "Female"
            }
        ]
    },

    "age": {
        "type": "number",
        "required": false,
        "read_only": false,
        "disabled": false,
        "label": "Age (years)",
        "placeholder": 35,
        "width": "max-sm:w-full w-2/3",
    },

    "height": {
        "type": "number",
        "required": false,
        "read_only": false,
        "disabled": false,
        "label": "Height (cm)",
        "placeholder": 180,
        "width": "max-sm:w-full w-2/3",
    },

    "weight": {
        "type": "number",
        "required": false,
        "read_only": false,
        "disabled": false,
        "label": "Weight (kg)",
        "placeholder": 75,
        "width": "max-sm:w-full w-2/3",
    },

    "bmr_kcal": {
        "type": "number",
        "required": false,
        "read_only": true,
        "disabled": true,
        "label": "Daily BMR (kcal)",
        "width": "max-sm:w-full w-2/3",
    },

    "scaling_kcal": {
        "type": "number",
        "required": false,
        "read_only": true,
        "disabled": true,
        "highlight": true,
        "label": "Equalizing Effort Factor (% for kcal)",
        "width": "max-sm:w-full w-2/3",
    },

    "step_length": {
        "type": "number",
        "required": false,
        "read_only": true,
        "disabled": true,
        "label": "Running Step Length (m)",
        "width": "max-sm:w-full w-2/3",
    },

    "scaling_distance": {
        "type": "number",
        "required": false,
        "read_only": true,
        "disabled": true,
        "highlight": true,
        "label": "Equalizing Distance Factor (% for km)",
        "width": "max-sm:w-full w-2/3",
    },

}


// The raw inputs (gender/age/height/weight) are never sent to the server -
// only the two derived equalizing factors are saved. To keep the promise
// "inputs stay on your device" WITHOUT resetting the form on every open,
// they are persisted in this device's localStorage only.
const INPUTS_STORAGE_KEY = 'wc_equalizer_inputs';

function loadSavedInputs() {
    try {
        return JSON.parse(localStorage.getItem(INPUTS_STORAGE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}


export default function GoalEqualizerForm({user, setModalState}) {

    const [values, setValues] = useState({});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    const [updateEntry, {
        error: updateError,
        isLoading: updateIsLoading,
    }] = useUpdateUserMutation();

    // Overall form error message
    useEffect(() => {
        if (updateError !== undefined) {
            setFormError('Update Error (' + updateError?.status?.toLocaleString() + ' ' + updateError?.originalStatus?.toLocaleString() + '): ' + updateError?.message);
        }
    }, [updateError])

    // load current form values: last typed inputs (this device), else the
    // profile gender, else the neutral defaults below
    useEffect(() => {
        const saved = loadSavedInputs();
        setValues(values => ({
            ...values,
            ...saved,
            gender: saved.gender || ((user?.gender === null || user?.gender === '' || user?.gender === undefined) ? 'M' : user.gender),
        }));
    }, [])

    // calculate factors
    useEffect(() => {
        const gender = (values.gender === undefined || values.gender === '') ? 'M' : values.gender;
        const age = (values.age === undefined || values.age === '') ? 35 : values.age;
        const height = (values.height === undefined || values.height === '') ? 180 : values.height;
        const weight = (values.weight === undefined || values.weight === '') ? 75 : values.weight;

        // Persist the raw inputs on this device once anything was typed -
        // never before (the mount run sees empty values and must not wipe
        // the saved inputs before the load effect's setState lands).
        if (values.gender || values.age || values.height || values.weight) {
            localStorage.setItem(INPUTS_STORAGE_KEY, JSON.stringify({
                gender: values.gender, age: values.age, height: values.height, weight: values.weight,
            }));
        }

        let bmr;
        let step_length;

        if (gender === 'F') {
            bmr = (10 * weight + 6.25 * height - 5 * age - 161) * 1.2;
            step_length = 0.60 * height / 100;
        } else {
            bmr = (10 * weight + 6.25 * height - 5 * age + 5) * 1.2;
            step_length = 0.65 * height / 100;
        }
        setValues({...values, bmr_kcal: Math.round(bmr), scaling_kcal: Math.round( bmr / 2046 * 100 * 100) / 100, step_length: Math.round(step_length * 100) / 100, scaling_distance: Math.round(step_length / 1.17 * 100 * 10) / 10});

    }, [values.gender, values.age, values.height, values.weight])


    // form action button right
    async function handleSubmit() {
        // update personal scaling factors
        try {
            const result = await updateEntry({id: 'me', scaling_kcal: Math.round(values.scaling_kcal * 100) / 10000, scaling_distance: Math.round(values.scaling_distance * 100) / 10000}).unwrap();
            console.log('Update Personal Scaling Factors success:', result);
            setModalState(false);
            document.body.classList.remove('body-no-scroll');
            window.alert('Saved. The re-calculation of your competition points might take a few minutes.');
        } catch (err) {
            console.error('Update Personal Scaling Factors failed', err);
            setFieldErrors(err.data);
        }
    }


    return (
        <Modal title="Equalize Goals" landscape={false} setShowModal={setModalState} isLoading={updateIsLoading}>
            <p className="text-gray-700 dark:text-gray-300">Everyone has a unique <b>Basal Metabolic Rate (BMR)</b>, dependent on factors like age, gender, height, and weight. To ensure a fair competition, the calculator below estimates your personal equalizing factors, which will be used to scale the competition goals. Your inputs <u>stay on your device</u> — only the final two equalizing percent factors (blue fields) are saved to equalize your points.</p>
            <p className="text-gray-500 text-sm italic">You still don't trust it? Check the <a className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer" href="https://github.com/vanalmsick/workout_challenge/blob/main/src-frontend/src/forms/equalizerForm.js#L149">public source code yourself (here)</a>!</p>
            <SingleForm fields={fields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-red-500 text-xs italic">{formError}</div>
            <div className="text-center text-gray-700 dark:text-gray-300 text-xs italic"><b>Current Effort Factor:</b> {Math.round(user.scaling_kcal * 100)}% / <b>Current Distance Factor:</b> {Math.round(user.scaling_distance * 100)}%</div>
            <div className="relative flex justify-between items-center">
                <SaveButton onClick={handleSubmit} label="Update" highlighted={true} larger={true} />
            </div>
        </Modal>
    )
}
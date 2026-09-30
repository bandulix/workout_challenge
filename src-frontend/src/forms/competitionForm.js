import React, {useEffect, useState} from "react";
import {
    useAddCompetitionMutation,
    useDeleteCompetitionMutation,
    useUpdateCompetitionMutation
} from "../utils/reducers/competitionsSlice";
import {useNavigate} from "react-router-dom";
import {ChangeOwnerButton, DeleteButton, Modal, SaveButton, SingleForm, useFormDirty} from "./basicComponents";
import {confirmAction} from "../utils/dialogs";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";
import {clearBodyScrollLock} from "../utils/overlay";


const fields = {

    "name": {
        "type": "text",
        "required": true,
        "read_only": false,
        "label": "Challenge name",
        "width": "max-sm:w-full w-1/2",
        "autoFocus": true,
    },

    "start_date": {
        "type": "date",
        "required": true,
        "read_only": false,
        "label": "Start Date",
        "width": "max-sm:w-1/2 w-1/4",
    },

    "end_date": {
        "type": "date",
        "required": true,
        "read_only": false,
        "label": "End Date",
        "width": "max-sm:w-1/2 w-1/4",
    },

    "has_teams": {
        "type": "checkbox",
        "required": false,
        "read_only": false,
        "label": "Users can compete in teams",
    },

    "organizer_assigns_teams": {
        "type": "checkbox",
        "required": false,
        "read_only": false,
        "label": "Only organizer can assign teams",
    },

    "expedition_enabled": {
        "type": "checkbox",
        "required": false,
        "read_only": false,
        "label": "Expedition: the group travels a shared route (Trail tab)",
    },

    "expedition_objective": {
        "type": "select",
        "required": false,
        "read_only": false,
        "label": "Objective",
        "width": "max-sm:w-full w-1/2",
        "placeholder": false,
        "selectList": [
            {value: "expedition", label: "Expedition - reach the far end together"},
            {value: "rescue", label: "Rescue run - stay ahead of the storm"},
            {value: "basecamp", label: "Base camp - hold the camp week after week"},
            {value: "treasure", label: "Treasure hunt - hidden landmarks"},
        ],
    },

    "expedition_theme": {
        "type": "select",
        "required": false,
        "read_only": false,
        "label": "Route",
        "width": "max-sm:w-full w-1/2",
        "placeholder": false,
        "selectList": [
            {value: "", label: "Surprise me (a route you haven't travelled)"},
            {value: "summit", label: "Summit"},
            {value: "ocean", label: "Ocean crossing"},
            {value: "desert", label: "Desert caravan"},
            {value: "space", label: "Space flight"},
            {value: "relay", label: "Marathon relay"},
        ],
    },

}


export default function CompetitionForm({competition, initialValues: prefillValues, isRematch = false, setModalState, setShowTransferCompetitionModal}) {
    const navigate = useNavigate();

    const initialFormValues = competition ?? prefillValues ?? {};
    const [values, setValues] = useState(initialFormValues);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    const [updateEntry, {
        error: updateError,
        isLoading: updateIsLoading,
    }] = useUpdateCompetitionMutation();
    const [createEntry, {
        error: createError,
        isLoading: createIsLoading,
    }] = useAddCompetitionMutation();
    const [deleteEntry, {
        error: deleteError,
        isLoading: deleteIsLoading,
    }] = useDeleteCompetitionMutation();

    // Overall form error message - human sentences via errText, never
    // raw status codes or server HTML.
    useEffect(() => {
        if (updateError !== undefined) {
            setFormError(errText(updateError, "Could not save the challenge. Please try again."));
        } else if (createError !== undefined) {
            setFormError(errText(createError, "Could not create the challenge. Please try again."));
        } else if (deleteError !== undefined) {
            setFormError(errText(deleteError, "Could not delete the challenge. Please try again."));
        }
    }, [updateError, createError, deleteError])

    // load current form values - and snapshot them for the dirty guard
    const [initialValues, setInitialValues] = useState(initialFormValues);
    useEffect(() => {
        if (competition !== undefined) {
            setValues(competition);
            setInitialValues(competition);
        } else if (prefillValues !== undefined) {
            setValues(prefillValues);
            setInitialValues(prefillValues);
        }
    }, [])
    
    // conditionally show/hide organizer_assigns_teams 
    const finalFields = {...fields};
    if (!values.has_teams) {
        delete finalFields.organizer_assigns_teams;
    }
    // Objective and route only matter with the Expedition on; once the
    // route is locked (challenge started) they are frozen server-side, so
    // show them read-only instead of pretending they can change.
    if (!values.expedition_enabled) {
        delete finalFields.expedition_objective;
        delete finalFields.expedition_theme;
    } else if (values.expedition_locked) {
        finalFields.expedition_objective = {...fields.expedition_objective, readOnly: true, label: "Objective (locked - the route has started)"};
        finalFields.expedition_theme = {...fields.expedition_theme, readOnly: true, label: "Route (locked)"};
    }

    // form action button left
    async function handleDiscard() {
        if (competition !== undefined) {
            // delete competition
            try {
                const confirmation = await confirmAction('You are deleting this challenge. This is irreversible. Are you sure?');
                if (confirmation) {
                    await deleteEntry(values.id).unwrap();
                    setModalState(false);
                    clearBodyScrollLock();
                    navigate('/dashboard/');
                }
            } catch (err) {
                // Surface the failure - this used to only console.error.
                console.error('Delete Competition failed', err);
                setFormError(errText(err, "Could not delete the challenge. Please try again."));
            }
        } else {
            // discard competition
            setValues({});
            setModalState(false);
            clearBodyScrollLock();
        }
    }

    // form action button right
    async function handleSubmit() {
        if (competition !== undefined) {
            // update competition
            try {
                await updateEntry(values).unwrap();
                setModalState(false);
                clearBodyScrollLock();
                toast.success('Saved. Points recalculate in the background - the page updates itself, usually within a minute.');
            } catch (err) {
                console.error('Update Competition failed', err);
                setFieldErrors(err.data);
            }
        } else {
            // create competition
            try {
                await createEntry(values).unwrap();
                setModalState(false);
                clearBodyScrollLock();
                // The new challenge page is interesting for about one
                // second - there is nothing on it yet. Land back on the
                // dashboard instead, where the challenge now shows up in
                // "My challenges" (visible feedback that it worked).
                toast.success("Challenge created. Invite your rivals from its page.");
                navigate('/dashboard');
            } catch (err) {
                console.error('Create Competition failed', err);
                setFieldErrors(err.data);
            }
        }
    }

    return (
        <Modal title={isRematch ? "Prepare a rematch" : "Challenge"} landscape={true} setShowModal={setModalState}
               isLoading={updateIsLoading || createIsLoading || deleteIsLoading}
               confirmDiscard={useFormDirty(values, initialValues)}>
            {isRematch && (
                <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
                    Review the fresh challenge window before creating it. Previous members are not added automatically; invite the group explicitly from the new challenge page.
                </p>
            )}
            <SingleForm fields={finalFields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-danger-text text-xs italic">{formError}</div>
            <div className="relative flex justify-between items-center">
                <DeleteButton onClick={handleDiscard} label={(competition !== undefined) ? "Delete" : "Discard"} highlighted={false} larger={true} />
                {(competition !== undefined) && <ChangeOwnerButton onClick={() => {setModalState(false); setShowTransferCompetitionModal(true);}} label={"Transfer Ownership"} highlighted={false} larger={true} />}
                <SaveButton onClick={handleSubmit} label={(competition !== undefined) ? "Update" : "Create"} highlighted={true} larger={true} />
            </div>
        </Modal>
    )
}
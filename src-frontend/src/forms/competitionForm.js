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

}


export default function CompetitionForm({competition, setModalState, setShowTransferCompetitionModal}) {
    const navigate = useNavigate();

    const [values, setValues] = useState({});
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
    const [initialValues, setInitialValues] = useState(competition ?? {});
    useEffect(() => {
        if (competition !== undefined) {
            setValues(competition);
            setInitialValues(competition);
        }
    }, [])
    
    // conditionally show/hide organizer_assigns_teams 
    const finalFields = {...fields};
    if (!values.has_teams) {
        delete finalFields.organizer_assigns_teams;
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
        <Modal title="Challenge" landscape={true} setShowModal={setModalState}
               isLoading={updateIsLoading || createIsLoading || deleteIsLoading}
               confirmDiscard={useFormDirty(values, initialValues)}>
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
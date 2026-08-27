import React, {useEffect, useState} from "react";
import {
    useAddCompetitionMutation,
    useDeleteCompetitionMutation,
    useUpdateCompetitionMutation
} from "../utils/reducers/competitionsSlice";
import {useNavigate} from "react-router-dom";
import {ChangeOwnerButton, DeleteButton, Modal, SaveButton, SingleForm} from "./basicComponents";
import {confirmAction, notice} from "../utils/dialogs";
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

    // Overall form error message
    useEffect(() => {
        if (updateError !== undefined) {
            setFormError('Update Error (' + updateError?.status?.toLocaleString() + ' ' + updateError?.originalStatus?.toLocaleString() + '): ' + updateError?.message);
        } else if (createError !== undefined) {
            setFormError('Create Error (' + createError?.status?.toLocaleString() + ' ' + createError?.originalStatus?.toLocaleString()  + '): ' + createError?.message);
        } else if (deleteError !== undefined) {
            setFormError('Delete Error (' + deleteError?.status?.toLocaleString() + ' ' + deleteError?.originalStatus?.toLocaleString()  + '): ' + deleteError?.message);
        }
    }, [updateError, createError, deleteError])

    // load current form values
    useEffect(() => {
        if (competition !== undefined) {
            setValues(competition);
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
                console.error('Delete Competition failed', err);
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
                await notice('Saved. Changes might take up to 10 minutes to reflect on the challenge page for all users.');
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
                // "My Competitions" (visible feedback that it worked).
                navigate('/dashboard');
            } catch (err) {
                console.error('Create Competition failed', err);
                setFieldErrors(err.data);
            }
        }
    }

    return (
        <Modal title="Challenge" landscape={true} setShowModal={setModalState} isLoading={updateIsLoading || createIsLoading || deleteIsLoading}>
            <SingleForm fields={finalFields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-red-500 text-xs italic">{formError}</div>
            <div className="relative flex justify-between items-center">
                <DeleteButton onClick={handleDiscard} label={(competition !== undefined) ? "Delete" : "Discard"} highlighted={false} larger={true} />
                {(competition !== undefined) && <ChangeOwnerButton onClick={() => {setModalState(false); setShowTransferCompetitionModal(true);}} label={"Transfer Ownership"} highlighted={false} larger={true} />}
                <SaveButton onClick={handleSubmit} label={(competition !== undefined) ? "Update" : "Create"} highlighted={true} larger={true} />
            </div>
        </Modal>
    )
}
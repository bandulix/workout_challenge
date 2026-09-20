import React, {useEffect, useState} from "react";
import {useJoinCompetitionMutation} from "../utils/reducers/joinSlice";
import {useNavigate} from "react-router-dom";
import {JoinButton, Modal, SingleForm} from "./basicComponents";
import {competitionsApi} from "../utils/reducers/competitionsSlice";
import {usersApi} from "../utils/reducers/usersSlice";
import {useDispatch} from "react-redux";
import {clearBodyScrollLock} from "../utils/overlay";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";


const fields = {

    "join_code": {
        "type": "text",
        "required": true,
        "read_only": false,
        "label": "Challenge join code",
        "width": "max-sm:w-full w-2/3",
        "autoFocus": true,
    },

}


export default function JoinCompetitionForm({setModalState, join_code= null}) {
    const navigate = useNavigate();
    const dispatch = useDispatch();

    // An invite link (?join=CODE) pre-fills the code, but joining still
    // needs one explicit tap on "Join challenge" - never join silently
    // on mount.
    const [values, setValues] = useState(join_code ? {join_code} : {});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    const [updateEntry, {
        error: updateError,
        isLoading: updateIsLoading,
    }] = useJoinCompetitionMutation();

    // Overall form error message - human sentence, never status soup.
    useEffect(() => {
        if (updateError !== undefined) {
            setFormError(errText(updateError, "Could not join the challenge. Check the code and try again."));
        }
    }, [updateError])

    // form action button right
    async function handleSubmit() {
        try {
            const result = await updateEntry(values.join_code).unwrap();
            setModalState(false);
            clearBodyScrollLock();
            dispatch(competitionsApi.util.invalidateTags(['Competition']));
            dispatch(usersApi.util.invalidateTags(['User']));
            toast.success("Welcome to the challenge!");
            navigate('/competition/' + result.competition);
        } catch (err) {
            console.error('Join Competition failed', err);
            setFieldErrors(err?.data || {});
            setFormError(errText(err, "Could not join the challenge. Check the code and try again."));
        }
    }

    return (
        <Modal title="Join challenge" landscape={false} setShowModal={setModalState} isLoading={updateIsLoading}>
            <SingleForm fields={fields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-danger-text text-xs italic" role="alert">{formError}</div>
            <div className="relative flex justify-end items-end">
              <JoinButton onClick={handleSubmit} label="Join challenge" highlighted={true} larger={true} />
            </div>
        </Modal>
    )
}

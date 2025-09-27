import React, {useEffect, useState} from "react";
import {
    competitionsApi,
    useUpdateCompetitionMutation
} from "../utils/reducers/competitionsSlice";
import {Modal, SaveButton, SingleForm} from "./basicComponents";
import {useGetUsersQuery} from "../utils/reducers/usersSlice";
import {useDispatch} from "react-redux";


const fields = {

    "owner": {
        "type": "select",
        "required": true,
        "read_only": false,
        "placeholder": false,
        "label": "New Competition Owner",
        "width": "max-sm:w-full w-2/3",
        "autoFocus": true,
    },

}


export default function TransferOwnershipForm({competition, setModalState}) {
    const dispatch = useDispatch();

    const [values, setValues] = useState({});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');
    const [finalFields, setFinalFields] = useState(fields);

    const {
        data: users,
        error: userError,
        isLoading: userLoading,
        isFetching: userFetching,
    } = useGetUsersQuery();
    const [updateEntry, {
        data: updateData,
        error: updateError,
        isLoading: updateIsLoading,
        isSuccess: updateIsSuccess
    }] = useUpdateCompetitionMutation();

    // Overall form error message
    useEffect(() => {
        if (updateError !== undefined) {
            setFormError('Update Error (' + updateError?.status?.toLocaleString() + ' ' + updateError?.originalStatus?.toLocaleString() + '): ' + updateError?.message);
        }
    }, [updateError])

    // load current form values
    useEffect(() => {
        if (competition !== undefined) {
            setValues(competition);
        }
    }, [])

    // load current form choices
    useEffect(() => {
        if (users !== undefined) {
            setFinalFields({owner: {...fields['owner'], selectList: users.map(user => ({value: user.id, label: user.username}))}});
        }
    }, [users])


    // form action button right
    async function handleSubmit() {
        // update competition
        try {
            const result = await updateEntry({id: competition.id, owner: parseInt(values['owner'])}).unwrap();
            console.log('Update Competition Ownership success:', result);
            setModalState(false);
            document.body.classList.remove('body-no-scroll');
            dispatch(competitionsApi.util.invalidateTags(['Competition']));
        } catch (err) {
            console.error('Update Competition Ownership failed', err);
            setFieldErrors(err.data);
        }
    }

    return (
        <Modal title="Transfer Competition Ownership" landscape={true} setShowModal={setModalState} isLoading={updateIsLoading}>
            <SingleForm fields={finalFields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-red-500 text-xs italic">{formError}</div>
            <div className="relative flex justify-end items-center">
              <SaveButton onClick={handleSubmit} label={"Update"} highlighted={true} larger={true} />
            </div>
        </Modal>
    )
}
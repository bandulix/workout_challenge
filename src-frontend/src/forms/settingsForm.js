import {useDeleteUserMutation, usersApi, useUpdateUserMutation} from "../utils/reducers/usersSlice";
import React, {useEffect, useState} from "react";
import {DeleteButton, Modal, SaveButton, SingleForm, StravaButton} from "./basicComponents";
import {useNavigate} from "react-router-dom";
import {useUnlinkStravaMutation, useLinkGarminMutation, useUnlinkGarminMutation} from "../utils/reducers/linkSlice";
import {useDispatch} from "react-redux";
import {Watch} from "lucide-react";
import {BeatLoader} from "react-spinners";


function GarminSection({user, onChanged}) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

    const [linkGarmin, {isLoading: linkLoading}] = useLinkGarminMutation();
    const [unlinkGarmin, {isLoading: unlinkLoading}] = useUnlinkGarminMutation();

    const linked = Boolean(user?.garmin_email);

    async function handleLink() {
        setMessage(null);
        setError(null);
        try {
            const res = await linkGarmin({email, password}).unwrap();
            setMessage(res?.message || "Garmin linked.");
            setPassword("");
            onChanged();
        } catch (err) {
            setError(err?.data?.message || "Could not link Garmin.");
        }
    }

    async function handleUnlink() {
        setMessage(null);
        setError(null);
        try {
            const res = await unlinkGarmin().unwrap();
            setMessage(res?.message || "Garmin unlinked.");
            onChanged();
        } catch (err) {
            setError(err?.data?.message || "Could not unlink Garmin.");
        }
    }

    const inputClass = "w-full shadow border border-gray-200 dark:border-ink-700/60 rounded-xl py-2 px-3 text-gray-700 dark:bg-ink-900 dark:text-gray-300 leading-tight focus:outline-none focus:border-volt-500";

    return (
        <div className="px-4 w-full">
            <div className="rounded-2xl border border-gray-200/70 dark:border-ink-700/60 p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Watch className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                    <span className="font-display text-xs uppercase tracking-wider">Garmin Connect</span>
                    {linked && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 px-2 py-0.5">linked</span>}
                </div>

                {linked ? (
                    <>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Linked as <b>{user.garmin_email}</b>
                            {user.garmin_last_synced_at && <> · last sync {user.garmin_last_synced_at_fmt}</>}
                        </p>
                        <button onClick={handleUnlink} disabled={unlinkLoading}
                                className="px-4 py-2 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-ink-800 dark:hover:bg-ink-700 text-sm font-semibold transition disabled:opacity-50">
                            {unlinkLoading ? <BeatLoader size={6}/> : "Unlink Garmin"}
                        </button>
                    </>
                ) : (
                    <>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Your Garmin password is used once to obtain access tokens and is <b>never stored</b> -
                            only the encrypted tokens are kept. Accounts with two-factor authentication can't be linked yet.
                        </p>
                        <input type="email" className={inputClass} placeholder="Garmin Connect email" autoComplete="off"
                               value={email} onChange={(e) => setEmail(e.target.value)}/>
                        <input type="password" className={inputClass} placeholder="Garmin Connect password" autoComplete="new-password"
                               value={password} onChange={(e) => setPassword(e.target.value)}/>
                        <button onClick={handleLink} disabled={linkLoading || !email || !password}
                                className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none">
                            {linkLoading ? <BeatLoader size={6}/> : "Connect Garmin"}
                        </button>
                    </>
                )}

                {message && <p className="text-xs text-volt-700 dark:text-volt-300">{message}</p>}
                {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
        </div>
    );
}


const fields = {

    "email": {
        "type": "email",
        "required": true,
        "read_only": false,
        "label": "Email",
        "width": "max-sm:w-full w-1/2",
    },

    "username": {
        "type": "text",
        "required": true,
        "read_only": false,
        "label": "Public Username",
        "width": "max-sm:w-full w-1/2",
    },

    "first_name": {
        "type": "text",
        "required": true,
        "read_only": false,
        "label": "First Name",
        "width": "max-sm:w-full w-1/3",
    },

    "last_name": {
        "type": "text",
        "required": true,
        "read_only": false,
        "label": "Last Name",
        "width": "max-sm:w-full w-1/3",
    },

    "gender": {
        "type": "select",
        "required": true,
        "read_only": false,
        "label": "Gender",
        "width": "max-sm:w-full w-1/3",
        "selectList": [
            {
                "value": "M",
                "label": "Male"
            },
            {
                "value": "F",
                "label": "Female"
            },
            {
                "value": "O",
                "label": "Other"
            },
            {
                "value": "",
                "label": "Unknown"
            }
        ]
    },

    "strava_athlete_id": {
        "type": "number",
        "required": false,
        "read_only": true,
        "disabled": true,
        "label": "Strava Athlete ID",
        "width": "max-sm:w-full w-1/2",
    },

    "strava_last_synced_at": {
        "type": "datetime-local",
        "required": false,
        "read_only": true,
        "disabled": true,
        "label": "Last Strava Sync",
        "width": "max-sm:w-full w-1/2",
    },

    "strava_allow_follow": {
        "type": "checkbox",
        "required": false,
        "read_only": false,
        "label": "Allow others to follow me on Strava",
    },

    "email_mid_week": {
        "type": "checkbox",
        "required": false,
        "read_only": false,
        "label": "Send me mid-week streak email",
    },

}


export default function SettingsForm({user, setModalState, setLinkStrava}) {
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const [values, setValues] = useState({});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    const [updateEntry, {
        data: updateData,
        error: updateError,
        isLoading: updateIsLoading,
        isSuccess: updateIsSuccess
    }] = useUpdateUserMutation();
    const [deleteEntry, {
        error: deleteError,
        isLoading: deleteIsLoading,
        isSuccess: deleteIsSuccess
    }] = useDeleteUserMutation();
    const [unlinkStrava, {
        data: unlinkData,
        error: unlinkError,
        isLoading: unlinkIsLoading,
        isSuccess: unlinkIsSuccess
    }] = useUnlinkStravaMutation();

    // Overall form error message
    useEffect(() => {
        if (updateError !== undefined) {
            setFormError('Update Error (' + updateError?.status?.toLocaleString() + ' ' + updateError?.originalStatus?.toLocaleString() + '): ' + updateError?.message);
        } else if (deleteError !== undefined) {
            setFormError('Delete Error (' + deleteError?.status?.toLocaleString() + ' ' + deleteError?.originalStatus?.toLocaleString() + '): ' + deleteError?.message);
        } else if (unlinkError !== undefined) {
            setFormError('Strava Unlink Error (' + unlinkError?.status?.toLocaleString() + ' ' + unlinkError?.originalStatus?.toLocaleString() + '): ' + unlinkError?.message);
        }
    }, [updateError, deleteError, unlinkError])

    // load current form values
    useEffect(() => {
        if (user !== undefined) {
            setValues(user);
        }
    }, [])

    // form action button left
    async function handleDelete() {
        // delete account
        try {
            const confirmation = window.confirm('You are deleting your account. All workouts and the competitions you organised will be deleted. This is irreversible. Are you sure?');
            if (confirmation) {
                const result = await deleteEntry(user.id).unwrap();
                console.log('Delete User success:', result);
                setModalState(false);
                document.body.classList.remove('body-no-scroll');
                navigate('/logout');
            }
        } catch (err) {
            console.error('Delete User failed', err);
        }
    }

    // form action button right
    async function handleSubmit() {
        // update personal details
        try {
            const result = await updateEntry({
                id: 'me',
                ...values,
                email: values.email.toLowerCase()
            }).unwrap();
            console.log('Update Personal Settings success:', result);
            setModalState(false);
            document.body.classList.remove('body-no-scroll');
            window.alert('Saved. Strava and username changes might take up to 10 minutes to reflect on the competition page for all users.');
        } catch (err) {
            console.error('Update Personal Settings failed', err);
            setFieldErrors(err.data);
        }
    }

    // form action button Strava linkage
    async function handleStravaLinkage({linked}) {
        if (linked) {
            // currently linked - unlink
            try {
                const result = await unlinkStrava().unwrap();
                console.log('Unlink Strava success:', result);
                setModalState(false);
                dispatch(usersApi.util.invalidateTags(['User']));
                document.body.classList.remove('body-no-scroll');
            } catch (err) {
                console.error('Unlink Strava failed', err);
                setFieldErrors(err.data);
            }
        } else {
            // currently unlinked - link
            setModalState(false);
            document.body.classList.remove('body-no-scroll');
            setLinkStrava(true);
        }
    }

    return (
        <Modal title="Personal Setting" landscape={true} setShowModal={setModalState} isLoading={updateIsLoading || deleteIsLoading || unlinkIsLoading}>
            <SingleForm fields={fields} values={values} setValues={setValues} errors={fieldErrors}/>
            <div className="text-center text-red-500 text-xs italic">{formError}</div>
            <div className="px-4">
                <StravaButton
                    label={(user.strava_athlete_id ? "Unlink" : "Link") + " Strava Account"}
                    onClick={() => handleStravaLinkage({linked: user.strava_athlete_id !== null && user.strava_athlete_id !== undefined && user.strava_athlete_id !== ''})}
                />
            </div>
            <GarminSection user={user} onChanged={() => dispatch(usersApi.util.invalidateTags(['User']))}/>
            <div className="relative flex justify-between items-center">
                <DeleteButton onClick={handleDelete} label="Delete Account" highlighted={false} larger={true} />
                <SaveButton onClick={handleSubmit} label="Update" highlighted={true} larger={true} />
            </div>
        </Modal>
    )
}
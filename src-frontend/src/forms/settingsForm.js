import {useDeleteUserMutation, usersApi, useUpdateUserMutation} from "../utils/reducers/usersSlice";
import React, {useEffect, useState} from "react";
import {FIELD_INPUT_CLASS, Modal, SaveButton, SingleForm, StravaButton, useFormDirty} from "./basicComponents";
import {useNavigate} from "react-router-dom";
import {useUnlinkStravaMutation, useResetStravaMutation, useLinkGarminMutation, useLinkGarminMfaMutation, useUnlinkGarminMutation, useLinkHealthMutation, useUnlinkHealthMutation} from "../utils/reducers/linkSlice";
import {useDispatch} from "react-redux";
import {Watch, Smartphone, Download, Volume2, VolumeX, KeyRound} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {isNativeHealthAvailable, nativeHealthConnect, nativeHealthDisconnect, nativeHealthSetSource} from "../utils/nativeHealth";
import {confirmAction} from "../utils/dialogs";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";
import {assetUrl} from "../utils/platform";
import {clearBodyScrollLock} from "../utils/overlay";
import {playSfx, useSfxEnabled} from "../utils/sfx";


const PROVIDER_LABELS = {strava: "Strava", garmin: "Garmin", health: "Apple/Google Health"};

function linkedProviders(user) {
    const linked = [];
    if (user?.strava_athlete_id) linked.push('strava');
    if (user?.garmin_email) linked.push('garmin');
    if (user?.health_user_id) linked.push('health');
    return linked;
}


// Only shown when SEVERAL providers are linked: picks which one actually
// imports activities, so the same activity never arrives twice (it
// usually exists in several ecosystems - e.g. recorded on a Garmin watch,
// auto-synced to Strava and mirrored into Apple Health).
function SyncSourceSection({user, onChanged}) {
    const [updateSource, {isLoading}] = useUpdateUserMutation();
    const [error, setError] = useState(null);
    const active = user?.activity_source_effective;
    const linked = linkedProviders(user);

    async function choose(source) {
        if (source === active || isLoading) return;
        setError(null);
        try {
            await updateSource({id: 'me', activity_source: source}).unwrap();
            // In the Android app the phone-side background sync follows
            // the selector: running for Health, paused for everything else.
            if (isNativeHealthAvailable()) nativeHealthSetSource(source);
            onChanged();
        } catch (err) {
            console.error('Switch activity source failed', err);
            setError("Could not switch the activity source - please try again.");
        }
    }

    const optionClass = (source) =>
        "flex-1 px-4 py-2.5 rounded-full text-sm font-bold uppercase tracking-wide transition disabled:opacity-50 " +
        (source === active
            ? "bg-volt-400 text-ink-950 shadow-glow-volt"
            : "btn-glass text-gray-600 dark:text-gray-300");

    return (
        <div className="rounded-2xl glass-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Watch className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                    <span className="font-display text-xs uppercase tracking-wider">Activity import source</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Several providers are linked. Only the selected source imports your activities,
                    so nothing gets doubled.
                </p>
                <div className="flex gap-2">
                    {linked.map((source) => (
                        <button key={source} onClick={() => choose(source)} disabled={isLoading} className={optionClass(source)}>
                            {PROVIDER_LABELS[source]}
                        </button>
                    ))}
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}


// Apple Health / Google Health Connect via the server's Open Wearables
// instance: linking hands the athlete a single-use connection code for
// the health app on their phone, which then pushes the on-device
// workouts to the server in the background. Inside the Android app the
// whole flow is one tap - the app redeems the code and talks to Health
// Connect natively (see utils/nativeHealth.js).
function HealthSection({user, onChanged}) {
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const [invitation, setInvitation] = useState(null);

    const [linkHealth, {isLoading: linkLoading}] = useLinkHealthMutation();
    const [unlinkHealth, {isLoading: unlinkLoading}] = useUnlinkHealthMutation();

    const linked = Boolean(user?.health_user_id);
    const isNative = isNativeHealthAvailable();

    // Android *browser*: direct sync belongs in the native app - offer
    // the APK download (published by scripts/build_apk.sh onto the same
    // server) instead of pushing the code flow.
    const isAndroidBrowser = !isNative && /Android/i.test(navigator.userAgent);
    const [apkAvailable, setApkAvailable] = useState(false);
    useEffect(() => {
        if (!isAndroidBrowser) return;
        fetch(assetUrl("/download/workout-challenge.apk"), {method: "HEAD", cache: "no-store"})
            .then((r) => setApkAvailable(r.ok))
            .catch(() => setApkAvailable(false));
    }, [isAndroidBrowser]);

    async function handleLink() {
        setMessage(null);
        setError(null);
        try {
            const res = await linkHealth().unwrap();
            if (isNative) {
                // Android app: redeem the code natively, request Health
                // Connect permissions and start the background sync - no
                // manual code entry.
                await nativeHealthConnect({code: res.code, host: res.host});
                setMessage("Health Connect linked - your workouts now sync in the background.");
            } else {
                setInvitation({code: res?.code, host: res?.host, expires_at: res?.expires_at});
                setMessage(res?.message || "Health linked.");
            }
            onChanged();
        } catch (err) {
            setInvitation(null);
            setError(err?.data?.message || err?.message || "Could not link Health.");
        }
    }

    async function handleUnlink() {
        setMessage(null);
        setError(null);
        setInvitation(null);
        const confirmed = await confirmAction(
            "Unlink Health? Workouts stop syncing until you connect again. Existing workouts are kept.");
        if (!confirmed) return;
        try {
            if (isNative) await nativeHealthDisconnect();
            const res = await unlinkHealth().unwrap();
            setMessage(res?.message || "Health unlinked.");
            onChanged();
        } catch (err) {
            setError(err?.data?.message || "Could not unlink Health.");
        }
    }

    return (
        <div className="rounded-2xl glass-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                    <span className="font-display text-xs uppercase tracking-wider">
                        {isNative ? "Google Health Connect" : "Apple / Google Health"}
                    </span>
                    {linked && <LinkedPill/>}
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Import workouts straight from Apple Health or Google Health Connect on your phone -
                    no Strava needed. {isNative
                        ? "One tap connects this app to Health Connect and syncs in the background."
                        : "The health app on your phone syncs them to this server in the background."}
                </p>

                {isAndroidBrowser && (
                    <div className="rounded-xl glass-well p-3 space-y-2">
                        <p className="text-xs text-gray-600 dark:text-gray-300">
                            <b>Best via our Android app:</b> direct Health Connect sync with one tap -
                            no code, no extra health app.
                        </p>
                        {apkAvailable ? (
                            <a href="/download/workout-challenge.apk" download
                               className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt">
                                <Download className="h-4 w-4"/> Download the app (APK)
                            </a>
                        ) : (
                            <p className="text-[11px] text-gray-400">
                                The APK is not published on this server yet - the code flow below works too.
                            </p>
                        )}
                    </div>
                )}

                {linked && user?.health_last_synced_at && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Last sync {user.health_last_synced_at_fmt?.date_readable}, {user.health_last_synced_at_fmt?.time_24h}
                    </p>
                )}

                {invitation?.code && (
                    <div className="rounded-xl glass-well p-3 space-y-1.5">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            In the health app (Open Wearables app, see your app store / the link your
                            organizer shared), choose <b>connect with code</b> and enter:
                        </p>
                        <p className="font-mono text-lg font-bold tracking-wider text-center select-all py-1">{invitation.code}</p>
                        {invitation.host && <p className="text-[11px] text-gray-400 text-center break-all">Server: {invitation.host}</p>}
                        <p className="text-[11px] text-gray-400 text-center">The code is single-use{invitation.expires_at ? " and expires soon" : ""} - generate a new one here anytime.</p>
                    </div>
                )}

                <div className="flex gap-2">
                    <button onClick={handleLink} disabled={linkLoading}
                            className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none">
                        {linkLoading ? <BeatLoader size={6} color="#0b0b0c"/> : (linked ? (isNative ? "Reconnect Health" : "New connection code") : (isNative ? "Connect Health Connect" : "Connect Health App"))}
                    </button>
                    {linked && (
                        <button onClick={handleUnlink} disabled={unlinkLoading}
                                className="px-4 py-2 rounded-full btn-glass text-sm font-semibold transition disabled:opacity-50">
                            {unlinkLoading ? <BeatLoader size={6} color="#d7ff3e"/> : "Unlink Health"}
                        </button>
                    )}
                </div>

                {message && !invitation?.code && <p className="text-xs text-volt-700 dark:text-volt-300">{message}</p>}
                {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}


function GarminSection({user, onChanged}) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    // Garmin forces two-step verification (email/SMS code) on many
    // accounts - after a correct password the server returns an
    // mfa_token and we ask for the code it sent.
    const [mfa, setMfa] = useState(null); // {token, method}
    const [mfaCode, setMfaCode] = useState("");
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

    const [linkGarmin, {isLoading: linkLoading}] = useLinkGarminMutation();
    const [linkGarminMfa, {isLoading: mfaLoading}] = useLinkGarminMfaMutation();
    const [unlinkGarmin, {isLoading: unlinkLoading}] = useUnlinkGarminMutation();

    const linked = Boolean(user?.garmin_email);

    async function handleLink() {
        setMessage(null);
        setError(null);
        try {
            const res = await linkGarmin({email, password}).unwrap();
            if (res?.mfa_required) {
                setMfa({token: res.mfa_token, method: res.mfa_method || "email"});
                setMfaCode("");
                return;
            }
            setMessage(res?.message || "Garmin linked.");
            setPassword("");
            onChanged();
        } catch (err) {
            setError(err?.data?.message || "Could not link Garmin.");
        }
    }

    async function handleMfa() {
        setMessage(null);
        setError(null);
        try {
            const res = await linkGarminMfa({mfa_token: mfa.token, mfa_code: mfaCode}).unwrap();
            setMessage(res?.message || "Garmin linked.");
            setPassword("");
            setMfa(null);
            setMfaCode("");
            onChanged();
        } catch (err) {
            setError(err?.data?.message || "Could not verify the code.");
        }
    }

    async function handleUnlink() {
        setMessage(null);
        setError(null);
        const confirmed = await confirmAction(
            "Unlink Garmin? New workouts stop syncing until you link a source again. Existing workouts are kept.");
        if (!confirmed) return;
        try {
            const res = await unlinkGarmin().unwrap();
            setMessage(res?.message || "Garmin unlinked.");
            onChanged();
        } catch (err) {
            setError(err?.data?.message || "Could not unlink Garmin.");
        }
    }

    return (
        <div className="rounded-2xl glass-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Watch className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                    <span className="font-display text-xs uppercase tracking-wider">Garmin Connect</span>
                    {linked && <LinkedPill/>}
                </div>

                {linked ? (
                    <>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Linked as <b>{user.garmin_email}</b>
                            {user.garmin_last_synced_at && <> · last sync {user.garmin_last_synced_at_fmt?.date_readable}, {user.garmin_last_synced_at_fmt?.time_24h}</>}
                        </p>
                        <button onClick={handleUnlink} disabled={unlinkLoading}
                                className="px-4 py-2 rounded-full btn-glass text-sm font-semibold transition disabled:opacity-50">
                            {unlinkLoading ? <BeatLoader size={6} color="#d7ff3e"/> : "Unlink Garmin"}
                        </button>
                    </>
                ) : mfa ? (
                    <>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Garmin sent a verification code to your {mfa.method === "email" ? "email" : "phone"} -
                            enter it to finish linking <b>{email}</b>.
                        </p>
                        <input type="text" inputMode="numeric" autoComplete="one-time-code"
                               className={FIELD_INPUT_CLASS} placeholder="6-digit code"
                               value={mfaCode} onChange={(e) => setMfaCode(e.target.value)}/>
                        <div className="flex gap-2">
                            <button onClick={handleMfa} disabled={mfaLoading || !mfaCode.trim()}
                                    className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none">
                                {mfaLoading ? <BeatLoader size={6} color="#0b0b0c"/> : "Verify & link"}
                            </button>
                            <button onClick={() => { setMfa(null); setMfaCode(""); setError(null); }}
                                    className="px-4 py-2 rounded-full btn-glass text-sm font-semibold transition">
                                Back
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Your Garmin password is used once to obtain access tokens and is <b>never stored</b> -
                            only the encrypted tokens are kept. If Garmin asks for a verification code, you can enter it right here.
                        </p>
                        <input type="email" className={FIELD_INPUT_CLASS} placeholder="Garmin Connect email" autoComplete="off"
                               value={email} onChange={(e) => setEmail(e.target.value)}/>
                        <input type="password" className={FIELD_INPUT_CLASS} placeholder="Garmin Connect password" autoComplete="new-password"
                               value={password} onChange={(e) => setPassword(e.target.value)}/>
                        <button onClick={handleLink} disabled={linkLoading || !email || !password}
                                className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none">
                            {linkLoading ? <BeatLoader size={6} color="#0b0b0c"/> : "Connect Garmin"}
                        </button>
                    </>
                )}

                {message && <p className="text-xs text-volt-700 dark:text-volt-300">{message}</p>}
                {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}


// In-app password change (no email roundtrip): current password + the
// new one twice. The server verifies the current password, runs the
// Django password validators and blacklists every refresh token - so
// on success every session (including this one) is logged out and the
// athlete signs back in with the new password.
export function PasswordSection() {
    const navigate = useNavigate();
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [repeat, setRepeat] = useState("");
    const [error, setError] = useState(null);
    const [updateUser, {isLoading}] = useUpdateUserMutation();

    async function handleChange() {
        setError(null);
        if (next !== repeat) {
            setError("The new passwords do not match.");
            return;
        }
        try {
            await updateUser({id: 'me', current_password: current, password: next}).unwrap();
            toast.success("Password changed - please log in again with your new password.");
            navigate('/logout');
        } catch (err) {
            const data = err?.data || {};
            const first = data.current_password || data.password || data.detail;
            setError(Array.isArray(first) ? first[0] : (first || "Could not change the password. Please try again."));
        }
    }

    return (
        <div className="rounded-2xl glass-card p-4 space-y-3">
            <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                <span className="font-display text-xs uppercase tracking-wider">Change password</span>
            </div>
            <input type="password" className={FIELD_INPUT_CLASS} placeholder="Current password"
                   autoComplete="current-password" aria-label="Current password"
                   value={current} onChange={(e) => setCurrent(e.target.value)}/>
            <input type="password" className={FIELD_INPUT_CLASS} placeholder="New password"
                   autoComplete="new-password" aria-label="New password"
                   value={next} onChange={(e) => setNext(e.target.value)}/>
            <input type="password" className={FIELD_INPUT_CLASS} placeholder="New password (repeat)"
                   autoComplete="new-password" aria-label="New password (repeat)"
                   value={repeat} onChange={(e) => setRepeat(e.target.value)}/>
            <button onClick={handleChange} disabled={isLoading || !current || !next || !repeat}
                    className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none">
                {isLoading ? <BeatLoader size={6} color="#0b0b0c"/> : "Change password"}
            </button>
            <p className="text-[11px] text-gray-400">You will be logged out everywhere and sign back in with the new password.</p>
            {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}

function SettingsGroup({title, hint, children}) {
    return (
        <section className="rounded-2xl glass-inset p-4 space-y-3">
            <div>
                <h3 className="font-display text-xs uppercase tracking-[0.16em]">{title}</h3>
                {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

function LinkedPill() {
    return (
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wide rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 px-2 py-0.5">linked</span>
    );
}

function SoundSettings() {
    const [on, setOn] = useSfxEnabled();
    return (
        <SettingsGroup title="Sounds" hint="Short stings for stamps, roast swipes, Echoes, votes, a revealed roast, and a full squad ring. Mute anytime.">
            <div className="rounded-2xl glass-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                    {on
                        ? <Volume2 className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                        : <VolumeX className="h-4 w-4 text-gray-400"/>}
                    <span className="font-display text-xs uppercase tracking-wider">Coach sounds</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Plays only while this app is open. Does not replace notification pings.
                </p>
                <button type="button"
                        onClick={() => {
                            const next = !on;
                            setOn(next);
                            if (next) playSfx("vote");
                        }}
                        aria-pressed={on}
                        className={"rounded-full px-4 py-2.5 text-sm font-bold uppercase tracking-wide min-h-[44px] transition " +
                            (on ? "bg-volt-400 text-ink-950 shadow-glow-volt" : "btn-glass")}>
                    {on ? "Sounds on" : "Sounds off"}
                </button>
            </div>
        </SettingsGroup>
    );
}

const profileFields = {
    first_name: {
        type: "text", required: true, label: "First name", width: "max-sm:w-full w-1/2",
    },
    last_name: {
        type: "text", required: true, label: "Last name", width: "max-sm:w-full w-1/2",
    },
    username: {
        type: "text", required: true, label: "Public username", width: "max-sm:w-full w-1/2",
    },
    email: {
        type: "email", required: true, label: "Email", width: "max-sm:w-full w-1/2",
    },
    current_password: {
        type: "password", required: false, label: "Current password (required to change email)", width: "max-sm:w-full w-1/2",
    },
    gender: {
        type: "select", required: true, label: "Gender", width: "max-sm:w-full w-1/2",
        selectList: [
            {value: "M", label: "Male"},
            {value: "F", label: "Female"},
            {value: "O", label: "Other"},
            {value: "", label: "Unknown"},
        ],
    },
};

const notifyFields = {
    email_mid_week: {
        type: "checkbox",
        required: false,
        label: "Send me the mid-week streak email",
    },
};


export default function SettingsForm({user, setModalState, setLinkStrava}) {
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const [values, setValues] = useState({});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState('');

    const [updateEntry, {
        error: updateError,
        isLoading: updateIsLoading,
    }] = useUpdateUserMutation();
    const [deleteEntry, {
        error: deleteError,
        isLoading: deleteIsLoading,
    }] = useDeleteUserMutation();
    const [unlinkStrava, {
        error: unlinkError,
        isLoading: unlinkIsLoading,
    }] = useUnlinkStravaMutation();
    const [resetStrava, {
        error: resetError,
        isLoading: resetIsLoading,
    }] = useResetStravaMutation();

    // Overall form error message - human sentences via errText, never
    // raw status codes or server HTML.
    useEffect(() => {
        if (updateError !== undefined) {
            setFormError(errText(updateError, "Could not save your settings. Please try again."));
        } else if (deleteError !== undefined) {
            setFormError(errText(deleteError, "Could not delete the account. Please try again."));
        } else if (unlinkError !== undefined) {
            setFormError(errText(unlinkError, "Could not unlink Strava. Please try again."));
        } else if (resetError !== undefined) {
            setFormError(errText(resetError, "Could not reset the Strava connection. Please try again."));
        }
    }, [updateError, deleteError, unlinkError, resetError])

    // load current form values - and snapshot them for the dirty guard
    const [initialValues, setInitialValues] = useState(null);
    useEffect(() => {
        if (user !== undefined) {
            setValues(user);
            setInitialValues(user);
        }
    }, [])

    // form action button left
    async function handleDelete() {
        // delete account
        try {
            const confirmation = await confirmAction('You are deleting your account. All workouts and the competitions you organised will be deleted. This is irreversible. Are you sure?');
            if (confirmation) {
                await deleteEntry(user.id).unwrap();
                setModalState(false);
                clearBodyScrollLock();
                navigate('/logout');
            }
        } catch (err) {
            console.error('Delete User failed', err);
        }
    }

    // Only these keys may ever leave this form - never the whole user
    // object (stale-clobbers edits from other devices, and keeps any
    // privilege/read-only field out of the payload for good).
    const EDITABLE_KEYS = [
        "first_name", "last_name", "username", "email", "gender",
        "email_mid_week", "strava_allow_follow", "current_password",
    ];

    // form action button right
    async function handleSubmit() {
        // update personal details
        try {
            // The import source is changed exclusively via its own
            // selector (which saves immediately) - it is not part of the
            // whitelist below.
            const whitelisted = Object.fromEntries(
                EDITABLE_KEYS.filter((k) => k in values).map((k) => [k, values[k]])
            );
            const current_password = values.current_password;
            const emailChanged = user?.email && values.email
                && values.email.toLowerCase() !== String(user.email).toLowerCase();
            if (emailChanged && !current_password) {
                setFieldErrors({current_password: "Current password is required to change email."});
                return;
            }
            if (!emailChanged) delete whitelisted.current_password;
            await updateEntry({
                id: 'me',
                ...whitelisted,
                email: values.email.toLowerCase(),
            }).unwrap();
            setModalState(false);
            clearBodyScrollLock();
            // Mention the background refresh only when a public-facing
            // field actually changed - not on every unrelated save.
            const publicChanged = values.username !== user?.username;
            toast.success(publicChanged
                ? 'Saved. Name changes update for everyone in the background, usually within a minute.'
                : 'Saved.');
        } catch (err) {
            console.error('Update Personal Settings failed', err);
            setFieldErrors(err.data);
        }
    }

    // Repair path for a broken Strava connection: wipe the connection
    // state server-side, then the user links again from scratch.
    async function handleStravaReset() {
        const confirmation = await confirmAction('Reset the Strava connection? This removes the stored linkage and sync state so you can link Strava again from scratch. Your workouts are kept.');
        if (!confirmation) return;
        try {
            await resetStrava().unwrap();
            dispatch(usersApi.util.invalidateTags(['User']));
            setModalState(false);
            clearBodyScrollLock();
            toast.success('Strava connection reset. Open the settings again and use "Link Strava" to connect from scratch.');
        } catch (err) {
            console.error('Reset Strava failed', err);
            setFieldErrors(err.data);
        }
    }

    // form action button Strava linkage
    async function handleStravaLinkage({linked}) {
        if (linked) {
            // currently linked - unlink (destructive: confirm first)
            const confirmed = await confirmAction(
                "Unlink Strava? New workouts stop syncing until you link a source again. Existing workouts are kept.");
            if (!confirmed) return;
            try {
                await unlinkStrava().unwrap();
                setModalState(false);
                dispatch(usersApi.util.invalidateTags(['User']));
                clearBodyScrollLock();
            } catch (err) {
                console.error('Unlink Strava failed', err);
                setFieldErrors(err.data);
            }
        } else {
            // currently unlinked - link
            setModalState(false);
            clearBodyScrollLock();
            setLinkStrava(true);
        }
    }

    const stravaLinked = user.strava_athlete_id !== null && user.strava_athlete_id !== undefined && user.strava_athlete_id !== '';
    const dirty = useFormDirty(values, initialValues);

    return (
        <Modal title="Account" landscape={true} setShowModal={setModalState}
               isLoading={updateIsLoading || deleteIsLoading || unlinkIsLoading || resetIsLoading}
               confirmDiscard={dirty}>
            <SettingsGroup title="Profile" hint="How you appear on the board and in the feed.">
                <div className="-mx-2">
                    <SingleForm fields={profileFields} values={values} setValues={setValues} errors={fieldErrors}/>
                </div>
            </SettingsGroup>

            <SettingsGroup title="Password" hint="Change it right here - no email needed.">
                <PasswordSection/>
            </SettingsGroup>

            <SettingsGroup title="Emails" hint={user.is_verified ? "Weekly mail only goes to a confirmed address." : "This address is not confirmed yet. Use the banner at the top to resend the link."}>
                <div className="-mx-2">
                    <SingleForm fields={notifyFields} values={values} setValues={setValues} errors={fieldErrors}/>
                </div>
            </SettingsGroup>

            <SettingsGroup title="Connected services" hint="Only one source imports activities, so the same workout never lands twice.">
                <div className="rounded-2xl glass-card p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <Watch className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                        <span className="font-display text-xs uppercase tracking-wider">Strava</span>
                        {stravaLinked && <LinkedPill/>}
                    </div>
                    <StravaButton
                        label={(stravaLinked ? "Unlink" : "Link") + " Strava"}
                        onClick={() => handleStravaLinkage({linked: stravaLinked})}
                    />
                    {stravaLinked && (
                        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input type="checkbox" className="mt-1"
                                   checked={!!values.strava_allow_follow}
                                   onChange={() => setValues({...values, strava_allow_follow: !values.strava_allow_follow})}/>
                            Allow others to follow me on Strava
                        </label>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Strava needs an active paid subscription to connect third-party apps (since June 2026).
                    </p>
                    {stravaLinked && (
                        <button type="button" onClick={handleStravaReset}
                                className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline">
                            Connection problems? Reset Strava
                        </button>
                    )}
                </div>
                <GarminSection user={user} onChanged={() => dispatch(usersApi.util.invalidateTags(['User']))}/>
                {(user?.health_configured || user?.health_user_id) && (
                    <HealthSection user={user} onChanged={() => dispatch(usersApi.util.invalidateTags(['User']))}/>
                )}
                {linkedProviders(user).length >= 2 && (
                    <SyncSourceSection user={user} onChanged={() => dispatch(usersApi.util.invalidateTags(['User']))}/>
                )}
            </SettingsGroup>

            <SoundSettings/>

            {formError && <p className="text-center text-danger-text text-xs italic">{formError}</p>}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                <button type="button" onClick={handleDelete}
                        className="text-sm font-semibold text-red-500 dark:text-red-400 hover:underline px-1 min-h-[44px]">
                    Delete account
                </button>
                <SaveButton onClick={handleSubmit} label="Save" highlighted={true} larger={true}/>
            </div>
            <AppVersionFooter/>
        </Modal>
    )
}


// Native app only: the running build's version + versionCode, so "did
// the update actually install?" is answerable without guessing (Android
// gives no rollback indication when an install silently fails).
function AppVersionFooter() {
    const [version, setVersion] = useState(null);
    useEffect(() => {
        if (!isNativeHealthAvailable()) return;  // native android only
        import("@capacitor/app").then(({App}) =>
            App.getInfo().then((info) => setVersion(`${info.version} (${info.build})`)).catch(() => null)
        );
    }, []);
    if (!version) return null;
    return (
        <p className="pb-2 text-center text-[11px] text-gray-400">App version {version}</p>
    );
}
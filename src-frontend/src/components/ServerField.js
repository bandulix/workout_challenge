import {useState} from "react";
import {getServerUrl, setServerUrl, hasStoredServerUrl, isNativeApp} from "../utils/platform";

// Native app only: one-time server address entry.
// One APK works on every instance - the app cannot know where it was
// downloaded from, so the user tells it once (pre-filled when the APK
// was built per-deployment with MAIN_HOST baked in). Saving reloads so
// every resolver picks the value up.
//
// RENDERED OUTSIDE any other <form>, on purpose: when this <form> was
// nested inside the login form, the submit event never crossed the inner
// form boundary while bubbling (it stops propagating at the outer form),
// so React's root-delegated onSubmit never fired.
export default function ServerField({alwaysEditing = false}) {
    const [url, setUrl] = useState(getServerUrl());
    const [editing, setEditing] = useState(
        alwaysEditing || (!hasStoredServerUrl() && !(process.env.REACT_APP_BACKEND_URL || ""))
    );

    if (!isNativeApp()) return null;

    function save(e) {
        e.preventDefault();
        setServerUrl(url);
        window.location.reload();
    }

    if (!editing) {
        return (
            <p className="mt-4 text-center">
                <button type="button" onClick={() => setEditing(true)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition">
                    Server: {getServerUrl() || "not set"} — <span className="underline">change</span>
                </button>
            </p>
        );
    }

    return (
        <form onSubmit={save} className="mt-5 rounded-2xl border border-ink-700/60 bg-ink-900/60 p-4 text-left">
            <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="server-url">
                Server address
            </label>
            <input
                className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                id="server-url" type="url" placeholder="https://workout.example.com"
                value={url} onChange={(e) => setUrl(e.target.value)} required={true}/>
            <p className="mt-1.5 text-[11px] text-gray-500">
                The address of your Workout Challenge server (where you downloaded this app).
            </p>
            <button type="submit"
                    className="mt-3 w-full bg-volt-400 hover:bg-volt-300 text-ink-950 font-bold py-2.5 px-5 rounded-full uppercase tracking-wide text-sm transition">
                Save & reload
            </button>
        </form>
    );
}

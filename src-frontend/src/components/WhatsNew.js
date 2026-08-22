import React, {useEffect, useState} from "react";
import {Camera, PartyPopper, RefreshCw, Sparkles} from "lucide-react";
import {Modal} from "../forms/basicComponents";
import {apiUrl} from "../utils/platform";

const HIGHLIGHTS = [
    {icon: Camera, title: "Photos on your workout", body: "Reply to your own session from the gallery — the coach remixes it."},
    {icon: RefreshCw, title: "Goals rescore the field", body: "Change a target and every workout in the challenge is recalculated."},
    {icon: Sparkles, title: "Home matches the Coach", body: "Cards, ink, volt — the rest of the app caught up."},
];

// "What's new" release popup: after every release, the user gets one
// popup with the changelog and a reload button.
//
// /api/version/ returns the release the SERVER is running (the git tag
// baked into the image). localStorage remembers the last release the
// user acknowledged; a mismatch means this device hasn't been told yet.
// "dev" builds (local dev, source builds) never nag.

const SEEN_KEY = "wc-release-version";
const POLL_MS = 15 * 60 * 1000; // also catches tabs left open across a deploy

function WhatsNew() {
    const [notes, setNotes] = useState(null);

    useEffect(() => {
        let alive = true;

        async function check() {
            try {
                // getServerUrl(): inside the native app a relative URL
                // resolves to the WebView origin (https://localhost) -
                // the popup could never appear there.
                const res = await fetch(apiUrl("/version/"));
                if (!res.ok) return;
                const data = await res.json();
                const version = (data?.version || "").trim();
                if (!version || version === "dev") return;

                const seen = localStorage.getItem(SEEN_KEY);
                if (seen === version) return;
                if (seen === null) {
                    // First visit since this feature exists (or a brand-new
                    // user) - don't bombard them; start tracking from now.
                    localStorage.setItem(SEEN_KEY, version);
                    return;
                }
                if (alive) setNotes(data);
            } catch (err) {
                // Offline or server rebooting - next poll retries.
            }
        }

        check();
        const id = setInterval(check, POLL_MS);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, []);

    if (!notes) return null;

    const version = notes.version;
    const close = () => {
        // Mark as seen on EVERY dismiss path (buttons, X, backdrop) so
        // the popup shows exactly once per release.
        localStorage.setItem(SEEN_KEY, version);
        setNotes(null);
    };
    const reload = () => {
        localStorage.setItem(SEEN_KEY, version);
        window.location.reload();
    };

    const sections = notes?.changelog?.sections || [];

    return (
        <Modal title={`What's new in ${version}`} landscape={false} setShowModal={close}>
            <div className="flex items-center gap-3 px-1">
                <span className="h-10 w-10 rounded-2xl bg-volt-400/15 flex items-center justify-center shrink-0">
                    <PartyPopper className="h-5 w-5 text-volt-500"/>
                </span>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    A new release just landed. Here's what you'll notice.
                </p>
            </div>

            <ul className="space-y-3 px-1">
                {HIGHLIGHTS.map((h) => (
                    <li key={h.title} className="flex items-start gap-3 rounded-2xl bg-gray-50 dark:bg-ink-900 border border-gray-200/70 dark:border-ink-700/60 p-3">
                        <span className="h-9 w-9 rounded-xl bg-volt-400/15 flex items-center justify-center shrink-0">
                            <h.icon className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                        </span>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold">{h.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{h.body}</p>
                        </div>
                    </li>
                ))}
            </ul>

            <div className="space-y-3 max-h-[32vh] overflow-y-auto px-1">
                {sections.length > 0 && (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Full notes</p>
                )}
                {sections.length === 0 ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">Bug fixes and improvements under the hood.</p>
                ) : (
                    sections.map((sec, i) => (
                        <div key={i}>
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{sec.title}</p>
                            <ul className="space-y-1 list-disc list-outside ml-4 text-sm text-gray-700 dark:text-gray-300">
                                {sec.items.slice(0, 4).map((item, j) => <li key={j}>{item}</li>)}
                            </ul>
                        </div>
                    ))
                )}
                {notes?.changelog?.truncated && (
                    <p className="text-xs text-gray-400 italic">…and more under the hood.</p>
                )}
            </div>

            <div className="relative flex justify-center gap-3 pt-2">
                <button onClick={close}
                        className="px-5 py-2.5 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-ink-800 dark:text-gray-200 dark:hover:bg-ink-700 text-sm font-semibold transition">
                    Later
                </button>
                <button onClick={reload}
                        className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt">
                    Reload
                </button>
            </div>
        </Modal>
    );
}

export default WhatsNew;

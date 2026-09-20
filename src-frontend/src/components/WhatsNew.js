import React, {useEffect, useRef, useState} from "react";
import {PartyPopper, Sparkles} from "lucide-react";
import {Modal} from "../forms/basicComponents";
import {apiUrl, isNativeApp} from "../utils/platform";

function athleteBullets(notes) {
    const skip = /operator|flower|loopback|secret at rest|crowdsec|nginx/i;
    const items = [];
    for (const sec of notes?.changelog?.sections || []) {
        for (const item of sec.items || []) {
            if (skip.test(item)) continue;
            items.push(item);
            if (items.length >= 5) return items;
        }
    }
    return items;
}

// One popup per server release. Athletes see a few bullets from this
// tag — not leftover operator notes from an older ship.

const SEEN_KEY = "wc-release-version";
const POLL_MS = 15 * 60 * 1000; // also catches tabs left open across a deploy

// Release-state channel for the "release spark" chip on Home:
// WhatsNew broadcasts {version, unseen} so the chip can show until the
// athlete has looked at the release notes; the chip asks for a reopen
// via "wc-whats-new-open".
function broadcastReleaseState(version, unseen) {
    window.dispatchEvent(new CustomEvent("wc-release-state", {detail: {version, unseen}}));
}

/** Small volt chip for headers while a release is unseen. */
export function ReleaseSpark() {
    const [state, setState] = useState(null);
    useEffect(() => {
        const onState = (e) => setState(e.detail);
        window.addEventListener("wc-release-state", onState);
        return () => window.removeEventListener("wc-release-state", onState);
    }, []);
    if (!state?.unseen || !state?.version) return null;
    return (
        <button type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("wc-whats-new-open"))}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-volt-400 text-ink-950 px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-widest shadow-glow-volt animate-pulse-ring transition hover:bg-volt-300"
                aria-label={`Version ${state.version} is new - open the release notes`}>
            <Sparkles className="h-4 w-4"/> New: {state.version}
        </button>
    );
}

function WhatsNew() {
    const [notes, setNotes] = useState(null);
    // Keep the last fetched payload so the ReleaseSpark chip can reopen
    // the popup after it was dismissed.
    const lastNotes = useRef(null);

    useEffect(() => {
        let alive = true;

        async function check() {
            try {
                // getServerUrl(): inside the native app a relative URL
                // resolves to the WebView origin (https://localhost) -
                // the popup could never appear there.
                const res = await fetch(apiUrl("/version/"), {cache: "no-store"});
                if (!res.ok) return;
                const data = await res.json();
                const version = (data?.version || "").trim();
                if (!version || version === "dev") return;

                const seen = localStorage.getItem(SEEN_KEY);
                if (seen === version) {
                    lastNotes.current = data;
                    broadcastReleaseState(version, false);
                    return;
                }
                if (seen === null) {
                    // First visit since this feature exists (or a brand-new
                    // user) - don't bombard them; start tracking from now.
                    localStorage.setItem(SEEN_KEY, version);
                    broadcastReleaseState(version, false);
                    return;
                }
                lastNotes.current = data;
                broadcastReleaseState(version, true);
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

    // The Home chip asks to reopen the release notes.
    useEffect(() => {
        const onOpen = () => {
            if (lastNotes.current) setNotes(lastNotes.current);
        };
        window.addEventListener("wc-whats-new-open", onOpen);
        return () => window.removeEventListener("wc-whats-new-open", onOpen);
    }, []);

    if (!notes) return null;

    const version = notes.version;
    const close = () => {
        // Mark as seen on EVERY dismiss path (buttons, X, backdrop) so
        // the popup shows exactly once per release.
        localStorage.setItem(SEEN_KEY, version);
        broadcastReleaseState(version, false);
        setNotes(null);
    };
    const reload = () => {
        localStorage.setItem(SEEN_KEY, version);
        window.location.reload();
    };

    const bullets = athleteBullets(notes);

    return (
        <Modal title={`What's new`} landscape={false} setShowModal={close}>
            <div className="flex items-center gap-3 px-1">
                <span className="h-11 w-11 rounded-2xl bg-volt-400 flex items-center justify-center shrink-0 shadow-glow-volt">
                    <PartyPopper className="h-5 w-5 text-ink-950"/>
                </span>
                <div className="min-w-0">
                    <p className="font-display text-lg uppercase tracking-wide text-volt-600 dark:text-volt-400 leading-tight">Version {version}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        A few things that changed in this release.
                    </p>
                </div>
            </div>

            <div className="px-1">
                {bullets.length === 0 ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">Bug fixes and improvements under the hood.</p>
                ) : (
                    <ul className="space-y-2 list-disc list-outside ml-4 text-sm text-gray-700 dark:text-gray-300">
                        {bullets.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                )}
            </div>

            <div className="relative flex justify-center gap-3 pt-2">
                {isNativeApp() ? (
                    <button onClick={close}
                            className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt">
                        Got it
                    </button>
                ) : (
                    <>
                        <button onClick={close}
                                className="px-5 py-2.5 rounded-full btn-glass text-sm font-semibold transition">
                            Later
                        </button>
                        <button onClick={reload}
                                className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition shadow-glow-volt">
                            Reload
                        </button>
                    </>
                )}
            </div>
        </Modal>
    );
}

export default WhatsNew;

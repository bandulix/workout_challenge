import React, {useEffect, useState} from "react";
import {PartyPopper} from "lucide-react";
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

function WhatsNew() {
    const [notes, setNotes] = useState(null);

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

    const bullets = athleteBullets(notes);

    return (
        <Modal title={`What's new in ${version}`} landscape={false} setShowModal={close}>
            <div className="flex items-center gap-3 px-1">
                <span className="h-10 w-10 rounded-2xl bg-volt-400/15 flex items-center justify-center shrink-0">
                    <PartyPopper className="h-5 w-5 text-volt-500"/>
                </span>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    A few things that changed in this release.
                </p>
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

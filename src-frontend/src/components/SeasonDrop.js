import React, {useEffect, useState} from "react";
import {createPortal} from "react-dom";

// Bump when the first-open poster should show again.
export const SEASON_ID = "trail-open-2";
const KEY = "wc-season-seen";

export function seasonUnseen() {
    try {
        return window.localStorage.getItem(KEY) !== SEASON_ID;
    } catch {
        return false;
    }
}

export function markSeasonSeen() {
    try {
        window.localStorage.setItem(KEY, SEASON_ID);
    } catch {
        /* private mode — the poster simply will not persist */
    }
}

// One full-screen poster, once. No changelog. The trail drawing is the message.
export default function SeasonDrop() {
    const [open, setOpen] = useState(seasonUnseen);

    function dismiss() {
        markSeasonSeen();
        setOpen(false);
    }

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
            if (event.key !== "Escape") return;
            markSeasonSeen();
            setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    if (!open) return null;

    return createPortal(
        <div
            aria-label="New season"
            aria-modal="true"
            className="fixed inset-0 z-[100] flex flex-col bg-ink-950 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] text-white"
            role="dialog"
        >
            <p className="t-pane text-white/55">New season</p>
            <h2 className="mt-3 font-display text-[3.25rem] uppercase leading-[0.9] tracking-tight">
                The trail<br/>is open
            </h2>
            <svg aria-hidden="true" className="my-auto w-full" viewBox="0 0 320 120">
                <path
                    d="M12 92 C 72 92, 96 34, 150 46 S 224 98, 308 24"
                    fill="none"
                    stroke="rgba(255,255,255,0.16)"
                    strokeLinecap="round"
                    strokeWidth="6"
                />
                <path
                    className="season-draw"
                    d="M12 92 C 72 92, 96 34, 150 46 S 224 98, 308 24"
                    fill="none"
                    pathLength="120"
                    stroke="#d7ff3e"
                    strokeLinecap="round"
                    strokeWidth="7"
                />
                <circle cx="150" cy="46" fill="#0b0b0c" r="7" stroke="#d7ff3e" strokeWidth="3"/>
                <circle cx="308" cy="24" fill="#d7ff3e" r="9"/>
            </svg>
            <button
                className="min-h-[52px] w-full rounded-full bg-volt-400 text-base font-bold uppercase tracking-widest text-ink-950 shadow-glow-volt hover:bg-volt-300"
                onClick={dismiss}
                type="button"
            >
                Step on
            </button>
        </div>,
        document.body,
    );
}

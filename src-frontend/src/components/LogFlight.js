import React, {useEffect, useState} from "react";
import {createPortal} from "react-dom";
import {sportIcon, sportLabelShort} from "../utils/sports";

function prefersReducedMotion() {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// After a save, the workout visibly leaves the dock and heads for the
// trail: one chip rises from the bottom centre and fades. Mounted once at
// the app root; listens for the `wc:logged` event the quick sheet fires.
export const LOGGED_EVENT = "wc:logged";

export default function LogFlight() {
    const [flight, setFlight] = useState(null);

    useEffect(() => {
        const onLogged = (event) => {
            if (prefersReducedMotion()) return;
            setFlight({...event.detail, key: Date.now()});
        };
        window.addEventListener(LOGGED_EVENT, onLogged);
        return () => window.removeEventListener(LOGGED_EVENT, onLogged);
    }, []);

    useEffect(() => {
        if (!flight) return undefined;
        const timer = setTimeout(() => setFlight(null), 1400);
        return () => clearTimeout(timer);
    }, [flight]);

    if (!flight) return null;
    const Icon = sportIcon(flight.sport);

    return createPortal(
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex justify-center">
            <span
                className="log-flight inline-flex items-center gap-2 btn-plate px-4 py-2 text-sm font-bold"
                key={flight.key}
            >
                <Icon className="h-4 w-4"/>
                {flight.minutes ? `+${flight.minutes} min` : sportLabelShort(flight.sport)}
            </span>
        </div>,
        document.body,
    );
}

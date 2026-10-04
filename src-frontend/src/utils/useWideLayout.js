import {useEffect, useState} from "react";

// True at Tailwind's md (768px) and up: the opened foldable's inner
// display (~768 CSS px portrait), dual-screen/landscape postures,
// tablets and desktops. Below that (phones incl. the foldable cover
// screen) the app keeps the one-column mobile layout with the bottom
// dock. Reactive: folding or rotating the device flips the layout live.
function wideMedia() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    return window.matchMedia("(min-width: 768px)");
}

export default function useWideLayout() {
    const [wide, setWide] = useState(() => Boolean(wideMedia()?.matches));
    useEffect(() => {
        const mq = wideMedia();
        if (!mq) return undefined;
        const apply = () => setWide(mq.matches);
        apply();
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
    }, []);
    return wide;
}

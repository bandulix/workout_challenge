import {useEffect, useState} from "react";

// True at Tailwind's md (768px) and up: the opened foldable's inner
// display (~768 CSS px portrait), dual-screen/landscape postures,
// tablets and desktops. Below that (phones incl. the foldable cover
// screen) the app keeps the one-column mobile layout with the bottom
// dock. Reactive: folding or rotating the device flips the layout live.
export default function useWideLayout() {
    const [wide, setWide] = useState(
        () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
    );
    useEffect(() => {
        const mq = window.matchMedia("(min-width: 768px)");
        const apply = () => setWide(mq.matches);
        apply();
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
    }, []);
    return wide;
}

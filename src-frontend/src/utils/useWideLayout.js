import {useEffect, useState} from "react";

// The opened foldable inner screen starts around 673 CSS px. The cover
// screen stays under 430. 600px is the rail; 880px is two panes.
function media(query) {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    return window.matchMedia(query);
}

function useMedia(query) {
    const [matches, setMatches] = useState(() => Boolean(media(query)?.matches));
    useEffect(() => {
        const mq = media(query);
        if (!mq) return undefined;
        const apply = () => setMatches(mq.matches);
        apply();
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
    }, [query]);
    return matches;
}

export default function useWideLayout() {
    return useMedia("(min-width: 600px)");
}

export function usePaneLayout() {
    return useMedia("(min-width: 880px)");
}

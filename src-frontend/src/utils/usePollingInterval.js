import {useEffect, useState} from "react";

/** RTK Query pollingInterval that pauses while the tab is hidden. */
export default function usePollingInterval(ms) {
    const [hidden, setHidden] = useState(
        () => typeof document !== "undefined" && document.visibilityState === "hidden",
    );
    useEffect(() => {
        const onChange = () => setHidden(document.visibilityState === "hidden");
        document.addEventListener("visibilitychange", onChange);
        return () => document.removeEventListener("visibilitychange", onChange);
    }, []);
    return hidden ? 0 : ms;
}

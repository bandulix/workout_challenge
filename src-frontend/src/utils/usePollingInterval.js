import {useEffect, useState} from "react";
import {subscribeForeground} from "./appLifecycle";

/** RTK Query pollingInterval that pauses while the tab / app is hidden. */
export default function usePollingInterval(ms) {
    const [hidden, setHidden] = useState(
        () => typeof document !== "undefined" && document.visibilityState === "hidden",
    );
    useEffect(() => subscribeForeground((active) => setHidden(!active)), []);
    return hidden ? 0 : ms;
}

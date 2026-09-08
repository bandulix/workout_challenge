import {useEffect} from "react";
import {useLocation} from "react-router-dom";
import {useGetDrillConfigsQuery} from "../utils/reducers/drillInstructorSlice";
import {hasAuthMarker} from "../utils/authTokens";
import {isPublicPath} from "../utils/publicPath";
import {useSfxEnabled} from "../utils/sfx";
import {startMidiBed, stopMidiBed, unlockMidiBed} from "../utils/midiBed";

function pickBedConfig(configs) {
    const withMidi = (configs || []).filter((c) => c.enabled && c.midi);
    if (!withMidi.length) return null;
    return [...withMidi].sort(
        (a, b) => new Date(b.last_posted_at || 0) - new Date(a.last_posted_at || 0),
    )[0];
}

export default function CoachMidiBed() {
    const location = useLocation();
    const publicPage = isPublicPath(location.pathname);
    const [sfxOn] = useSfxEnabled();
    const {data: configs} = useGetDrillConfigsQuery(undefined, {
        skip: publicPage || !hasAuthMarker(),
    });
    const bed = pickBedConfig(configs);

    useEffect(() => {
        if (publicPage || !sfxOn || !bed?.midi) {
            stopMidiBed();
            return undefined;
        }
        let cancelled = false;
        startMidiBed(bed.midi).catch(() => {});
        function onVis() {
            if (document.hidden) stopMidiBed();
            else if (!cancelled) startMidiBed(bed.midi).catch(() => {});
        }
        function onUnlock() {
            unlockMidiBed();
            if (!cancelled) startMidiBed(bed.midi).catch(() => {});
        }
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("pointerdown", onUnlock, {passive: true, once: true});
        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("pointerdown", onUnlock);
            stopMidiBed();
        };
    }, [publicPage, sfxOn, bed?.id, bed?.midi]);

    return null;
}

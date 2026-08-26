import React, {useMemo} from "react";
import {useLocation} from "react-router-dom";
import {isPublicPath} from "../utils/publicPath";
import {backdropUrls} from "../utils/dailyBackdrop";

// One action plate behind the whole app, swapped once a local calendar
// day. Slow Ken Burns zoom runs on every screen.
export default function AppBackdrop() {
    const {pathname} = useLocation();
    const cinematic = isPublicPath(pathname);
    const {webp, jpg} = useMemo(() => backdropUrls(), []);

    return (
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
            <picture>
                <source srcSet={webp} type="image/webp"/>
                <img src={jpg} alt=""
                     className="absolute inset-0 h-full w-full object-cover object-center animate-kenburns"/>
            </picture>
            <div className={"absolute inset-0 " + (cinematic
                ? "bg-gradient-to-b from-ink-950/25 via-ink-950/40 to-ink-950/88"
                : "bg-gradient-to-b from-ink-950/35 via-ink-950/50 to-ink-950/78")}/>
            {!cinematic && (
                <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-80 w-80 rounded-full bg-volt-400/12 blur-3xl"/>
            )}
        </div>
    );
}

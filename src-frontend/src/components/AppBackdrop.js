import React, {useMemo} from "react";
import {useLocation} from "react-router-dom";
import {isPublicPath} from "../utils/publicPath";
import {backdropUrls} from "../utils/dailyBackdrop";

// One action plate behind the whole app, swapped once a local calendar
// day. Slow Ken Burns zoom runs on every screen. Coach gets a quieter
// veil so the persona hero wash can lead without fighting the plate.
export default function AppBackdrop({forceCinematic = false}) {
    const {pathname} = useLocation();
    const cinematic = forceCinematic || isPublicPath(pathname);
    const onCoach = pathname === "/coach" || pathname.startsWith("/coach/");
    const {webp, jpg} = useMemo(() => backdropUrls(), []);

    const veil = cinematic
        ? "bg-gradient-to-b from-ink-950/25 via-ink-950/40 to-ink-950/88"
        : onCoach
            ? "bg-gradient-to-b from-ink-950/45 via-ink-950/58 to-ink-950/82"
            : "bg-gradient-to-b from-ink-950/35 via-ink-950/50 to-ink-950/78";

    return (
        <div className="app-backdrop" aria-hidden="true">
            <picture>
                <source srcSet={webp} type="image/webp"/>
                <img src={jpg} alt="" className={"app-backdrop-img animate-kenburns" + (onCoach ? " opacity-85" : "")}/>
            </picture>
            <div className={"absolute inset-0 " + veil}/>
            {!cinematic && !onCoach && (
                <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-80 w-80 rounded-full bg-white/10 blur-3xl"/>
            )}
        </div>
    );
}

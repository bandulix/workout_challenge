import React, {useMemo} from "react";
import {useLocation} from "react-router-dom";
import {useTheme} from "../utils/theme";
import {isPublicPath} from "../utils/publicPath";
import {backdropUrls} from "../utils/dailyBackdrop";

// One action plate behind the whole app, swapped once a local calendar
// day. Dark mode (and login) keep the night grade; light mode uses the
// brighter twin. Slow Ken Burns zoom runs on every screen.
export default function AppBackdrop() {
    const {pathname} = useLocation();
    const {resolvedTheme} = useTheme();
    const cinematic = isPublicPath(pathname);
    const night = cinematic || resolvedTheme === "dark";
    const {webp, jpg} = useMemo(() => backdropUrls(night), [night]);

    return (
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
            <picture>
                <source srcSet={webp} type="image/webp"/>
                <img src={jpg} alt=""
                     className="absolute inset-0 h-full w-full object-cover object-center animate-kenburns"/>
            </picture>
            <div className={"absolute inset-0 " + (cinematic
                ? "bg-gradient-to-b from-ink-950/25 via-ink-950/40 to-ink-950/88"
                : "bg-gradient-to-b from-[#efece4]/45 via-[#efece4]/40 to-[#efece4]/78 dark:from-ink-950/35 dark:via-ink-950/50 dark:to-ink-950/78")}/>
            {!cinematic && (
                <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-80 w-80 rounded-full bg-volt-400/10 dark:bg-volt-400/12 blur-3xl"/>
            )}
        </div>
    );
}

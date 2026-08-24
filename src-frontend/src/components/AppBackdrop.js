import React from "react";
import {useLocation} from "react-router-dom";
import {useTheme} from "../utils/theme";

const PUBLIC = ["/", "/login", "/signup", "/logout"];

function onPublicPath(pathname) {
    return PUBLIC.includes(pathname) || pathname.startsWith("/password");
}

// One gym plate behind the whole app. Dark mode (and login) keep the
// night photo; light mode uses the daylight twin so the frost still sits
// on a matching scene. Ken Burns only on public screens.
export default function AppBackdrop() {
    const {pathname} = useLocation();
    const {resolvedTheme} = useTheme();
    const cinematic = onPublicPath(pathname);
    const night = cinematic || resolvedTheme === "dark";
    const webp = night ? "/login-bg.webp" : "/login-bg-light.webp";
    const jpg = night ? "/login-bg.jpg" : "/login-bg-light.jpg";

    return (
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
            <picture>
                <source srcSet={webp} type="image/webp"/>
                <img src={jpg} alt=""
                     className={"absolute inset-0 h-full w-full object-cover object-center " +
                         (cinematic ? "animate-kenburns" : "")}/>
            </picture>
            <div className={"absolute inset-0 " + (cinematic
                ? "bg-gradient-to-b from-ink-950/25 via-ink-950/40 to-ink-950/88"
                : "bg-gradient-to-b from-[#d4deba]/35 via-[#d4deba]/25 to-[#d4deba]/65 dark:from-ink-950/35 dark:via-ink-950/50 dark:to-ink-950/78")}/>
            {!cinematic && (
                <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-80 w-80 rounded-full bg-volt-400/20 dark:bg-volt-400/12 blur-3xl"/>
            )}
        </div>
    );
}

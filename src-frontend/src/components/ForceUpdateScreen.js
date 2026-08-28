import {Download} from "lucide-react";
import {BarLoader} from "react-spinners";
import {apkDownloadHref} from "../utils/apkUpdate";
import ServerField from "./ServerField";

function BrandFrame({children, tagline}) {
    return (
        <div className="relative z-10 min-h-screen overflow-hidden">
            <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-volt-400/25 blur-3xl z-0"/>
            <div className="relative z-10 flex items-center justify-center min-h-screen px-4">
                <div className="p-8 max-w-md w-full text-center text-white my-4 animate-slide-up">
                    <img src="/icon-192.png" alt="" width={56} height={56}
                         className="h-14 w-14 mx-auto mb-5 rounded-2xl shadow-glow-volt animate-float-slow"/>
                    <h1 className="font-display text-4xl uppercase leading-none mb-3">
                        Workout<br/>
                        <span className="text-volt-400">Challenge</span>
                    </h1>
                    {tagline && (
                        <p className="font-display text-xs uppercase tracking-[0.3em] text-gray-400 mb-6">
                            {tagline}
                        </p>
                    )}
                    {children}
                </div>
            </div>
        </div>
    );
}

export function ForceUpdateChecking() {
    return (
        <BrandFrame tagline="Checking for an update">
            <div className="flex justify-center pt-2">
                <BarLoader height={6} width={200} color="#d7ff3e"/>
            </div>
            <ServerField/>
        </BrandFrame>
    );
}

export default function ForceUpdateScreen({update}) {
    const latest = update?.versionName || "a newer build";
    const current = update?.currentName
        ? `${update.currentName} (${update.currentCode})`
        : `build ${update?.currentCode || "?"}`;

    return (
        <BrandFrame tagline="Update required">
            <p className="text-base text-gray-200 mb-8 leading-relaxed">
                This phone is on <b className="text-volt-300">{current}</b>.
                The server is serving <b className="text-volt-300">{latest}</b>.
                Install over the top — your login and data stay.
            </p>
            <a href={apkDownloadHref()}
               rel="noopener noreferrer"
               className="inline-flex items-center justify-center gap-2 w-full min-h-[48px] rounded-full bg-volt-400 text-ink-950 px-8 py-3.5 font-bold uppercase tracking-wide text-sm hover:bg-volt-300 transition active:scale-95 shadow-glow-volt">
                <Download className="h-4 w-4"/>
                Download update
            </a>
            <p className="mt-4 text-[11px] text-gray-500 leading-relaxed">
                Android will download the APK. Open that file, then tap Update.
                After it installs, open Workout Challenge again.
            </p>
            <ServerField/>
        </BrandFrame>
    );
}

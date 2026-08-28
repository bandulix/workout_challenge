import {useEffect, useState} from "react";
import {App} from "@capacitor/app";
import {isNativeApp, assetUrl, getServerUrl} from "./platform";
import {onAppResume} from "./appLifecycle";
import {pinNativeMediaOrigin} from "./protectedMedia";

// Always a same-origin or http(s) absolute path. The JSON-supplied URL
// is ignored (it was previously an XSS sink). Native WebViews resolve
// relative /download/ against https://localhost, so we prefix the
// sanitized server origin there.
export function apkDownloadHref() {
    const base = getServerUrl();
    if (!base) return "/download/workout-challenge.apk";
    return new URL("/download/workout-challenge.apk", base + "/").href;
}

export {isApkOutdated} from "./queryPage";

// Sideload APK vs the APK the server is publishing
// (/download/apk-version.json, stamped by scripts/build_apk.sh).
// Fail-open: missing manifest, offline, or a parse error must not brick
// the phone. A known-newer server build is the only "outdated" case.
export async function readApkUpdate() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let info;
    let resp;
    try {
        [info, resp] = await Promise.all([
            App.getInfo(),
            fetch(assetUrl("/download/apk-version.json"), {cache: "no-store", signal: ctrl.signal}),
        ]);
    } finally {
        clearTimeout(timer);
    }
    if (!resp.ok) return null;
    const latest = await resp.json();
    const currentCode = parseInt(info.build, 10) || 0;
    const latestCode = parseInt(latest.versionCode, 10) || 0;
    if (!latestCode) return null;
    return {
        currentCode,
        latestCode,
        currentName: String(info.version || ""),
        versionName: String(latest.versionName || ""),
    };
}

// Native only. Browser/PWA always `ready` (they already run the server's
// JS). Checking must not mount the rest of the app: BottomNav + live
// queries would fire before we know this APK is allowed.
export function useApkGate() {
    const [state, setState] = useState(() => (
        isNativeApp()
            ? {status: "checking", update: null}
            : {status: "ready", update: null}
    ));

    useEffect(() => {
        if (!isNativeApp()) return undefined;
        let alive = true;

        async function check() {
            pinNativeMediaOrigin();
            try {
                const result = await readApkUpdate();
                if (!alive) return;
                if (result && isApkOutdated(result.currentCode, result.latestCode)) {
                    setState({status: "outdated", update: result});
                } else {
                    setState({status: "ready", update: null});
                }
            } catch {
                // Offline / no APK published yet: keep using the app,
                // unless we already know this build is behind.
                if (alive) {
                    setState((prev) => (prev.status === "outdated" ? prev : {status: "ready", update: null}));
                }
            }
        }

        check();
        const stop = onAppResume(check);
        return () => {
            alive = false;
            if (typeof stop === "function") stop();
        };
    }, []);

    return state;
}

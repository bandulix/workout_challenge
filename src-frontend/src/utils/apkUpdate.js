import {useEffect, useState} from "react";
import {App} from "@capacitor/app";
import {isNativeApp, getServerUrl} from "./serverUrl";

// In-app update check for the sideloaded APK: the server publishes
// /download/apk-version.json next to the APK (scripts/build_apk.sh
// stamps versionName from the git tag and versionCode from the commit
// count). When the server's build is newer, the dashboard shows a
// banner that links the APK download - Android installs it over the
// existing app (same signing key = update, data kept).
const DISMISS_KEY = "wc_apk_update_dismissed";

export function useApkUpdateInfo() {
    const [update, setUpdate] = useState(null);

    useEffect(() => {
        if (!isNativeApp()) return;
        let alive = true;
        (async () => {
            try {
                const [info, resp] = await Promise.all([
                    App.getInfo(),
                    fetch(`${getServerUrl()}/download/apk-version.json`, {cache: "no-store"}),
                ]);
                if (!resp.ok) return;
                const latest = await resp.json();
                const currentCode = parseInt(info.build, 10) || 0;
                const latestCode = parseInt(latest.versionCode, 10) || 0;
                const dismissed = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10) || 0;
                if (alive && latestCode > currentCode && latestCode > dismissed) {
                    setUpdate({
                        versionName: latest.versionName || "",
                        versionCode: latestCode,
                        url: `${getServerUrl()}${latest.url || "/download/workout-challenge.apk"}`,
                    });
                }
            } catch (e) {
                // No update info published yet (or offline) - stay quiet.
            }
        })();
        return () => { alive = false; };
    }, []);

    function dismiss() {
        if (update) localStorage.setItem(DISMISS_KEY, String(update.versionCode));
        setUpdate(null);
    }

    return {update, dismiss};
}

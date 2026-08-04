import {Capacitor} from "@capacitor/core";

// Backend base URL resolution.
//
// Browser/PWA: the build-time REACT_APP_BACKEND_URL ("" = same origin,
// the normal deployment behind nginx).
//
// Native app (Android): the SAME baked value - the APK is built per
// deployment by scripts/build_apk.sh, which feeds the deployment's own
// MAIN_HOST from .env, so the app always knows its server. An optional
// localStorage override stays available for point-the-same-apk-
// elsewhere debugging.
const STORAGE_KEY = "wc_server_url";

export function isNativeApp() {
    return Capacitor.isNativePlatform();
}

export function getServerUrl() {
    const stored = isNativeApp() ? (localStorage.getItem(STORAGE_KEY) || "") : "";
    const raw = stored || (process.env.REACT_APP_BACKEND_URL || "");
    return raw.trim().replace(/\/+$/, "");
}

import {Capacitor} from "@capacitor/core";

// Backend base URL resolution.
//
// Browser/PWA: the build-time REACT_APP_BACKEND_URL ("" = same origin,
// the normal deployment behind nginx).
//
// Native app (Android): a one-time server entry on the login screen
// (localStorage) - ONE apk works on every instance; an APK cannot know
// where it was downloaded from. When built per-deployment via
// scripts/build_apk.sh, the baked MAIN_HOST value serves as the
// pre-filled default and the entry is just confirmation.
const STORAGE_KEY = "wc_server_url";

export function isNativeApp() {
    return Capacitor.isNativePlatform();
}

export function getServerUrl() {
    const stored = isNativeApp() ? (localStorage.getItem(STORAGE_KEY) || "") : "";
    const raw = stored || (process.env.REACT_APP_BACKEND_URL || "");
    return raw.trim().replace(/\/+$/, "");
}

export function setServerUrl(url) {
    localStorage.setItem(STORAGE_KEY, (url || "").trim());
}

// Whether a server is explicitly stored (vs only the baked default).
export function hasStoredServerUrl() {
    return !!(localStorage.getItem(STORAGE_KEY) || "").trim();
}

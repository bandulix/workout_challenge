import {getServerUrl, setServerUrl, hasStoredServerUrl, isNativeApp} from "./serverUrl";

export {getServerUrl, setServerUrl, hasStoredServerUrl, isNativeApp};

/** Absolute URL for an API path (`/api/...` or `user/me/` → `/api/user/me/`). */
export function apiUrl(path) {
    const base = getServerUrl();
    let p = path.startsWith("/") ? path : `/${path}`;
    if (!p.startsWith("/api/") && p !== "/api") {
        p = "/api" + (p.startsWith("/") ? p : `/${p}`);
    }
    return base + p;
}

/** Absolute URL for a same-origin static path (`/download/...`, `/personas/...`). */
export function assetUrl(path) {
    const base = getServerUrl();
    const p = path.startsWith("/") ? path : `/${path}`;
    return base + p;
}

import {getServerUrl} from "./serverUrl";

// Shared session helpers. CrowdSec/fail2ban HTTP brute-force scenarios
// trip on bursts of 401s - which this app used to produce every time the
// 5-minute access token expired: every polling slice AND every avatar
// fetch hit the API with a dead JWT at once. Refreshing *before* expiry
// (and sharing one in-flight POST /token/refresh/) keeps those 401s off
// the wire.

const REFRESH_SKEW_MS = 60 * 1000;

let refreshPromise = null;

export function getAccessToken() {
    return localStorage.getItem("access_token");
}

export function getRefreshToken() {
    return localStorage.getItem("refresh_token");
}

export function accessTokenExpiresAt(token) {
    if (!token || typeof token !== "string") return 0;
    const parts = token.split(".");
    if (parts.length < 2) return 0;
    try {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = "=".repeat((4 - (b64.length % 4)) % 4);
        const payload = JSON.parse(atob(b64 + pad));
        return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
    } catch {
        return 0;
    }
}

export function accessTokenNeedsRefresh(token = getAccessToken()) {
    if (!getRefreshToken()) return false;
    const exp = accessTokenExpiresAt(token);
    if (!exp) return true;
    return exp - Date.now() <= REFRESH_SKEW_MS;
}

function fetchWithTimeout(url, options, ms = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, {...options, signal: ctrl.signal}).finally(() => clearTimeout(timer));
}

export function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        const refresh = getRefreshToken();
        if (!refresh) return "none";
        try {
            const res = await fetchWithTimeout(`${getServerUrl()}/api/token/refresh/`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({refresh}),
                cache: "no-store",
            });
            if (res.ok) {
                const data = await res.json();
                if (data.access) {
                    // A login that finished while this refresh was on the
                    // wire owns the current keys - do not overwrite them.
                    if (getRefreshToken() === refresh) {
                        localStorage.setItem("access_token", data.access);
                        if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
                    }
                    return "ok";
                }
            }
            if (res.status === 400 || res.status === 401) {
                // A stale in-flight refresh must not wipe tokens from a
                // login that finished while this request was on the wire.
                if (getRefreshToken() === refresh) {
                    localStorage.removeItem("refresh_token");
                    localStorage.removeItem("access_token");
                }
                return "dead";
            }
            return "fail";
        } catch {
            return "fail";
        }
    })().finally(() => {
        refreshPromise = null;
    });
    return refreshPromise;
}

export async function ensureFreshAccessToken() {
    if (!getRefreshToken()) return "none";
    if (!accessTokenNeedsRefresh()) return "ok";
    return refreshAccessToken();
}

import {useEffect, useState} from "react";
import {App} from "@capacitor/app";
import {isNativeApp, assetUrl, getServerUrl} from "./platform";
import {onAppResume} from "./appLifecycle";
import {pinNativeMediaOrigin} from "./protectedMedia";
import {isApkOutdated} from "./queryPage";

export {isApkOutdated};

// Kept for callers/tests that still import it. Splash no longer uses a
// TTL — a current cache skips the spinner; the network always rechecks.
export const APK_GATE_TTL_MS = 24 * 60 * 60 * 1000;
export const APK_GATE_STORAGE_KEY = "wc_apk_gate";

// Always a same-origin or http(s) absolute path. The JSON-supplied URL
// is ignored (it was previously an XSS sink). Native WebViews resolve
// relative /download/ against https://localhost, so we prefix the
// sanitized server origin there.
export function apkDownloadHref() {
    const base = getServerUrl();
    if (!base) return "/download/workout-challenge.apk";
    return new URL("/download/workout-challenge.apk", base + "/").href;
}

export function parseApkGateCache(raw) {
    if (!raw || typeof raw !== "object") return null;
    const origin = typeof raw.origin === "string" ? raw.origin : "";
    const currentCode = parseInt(raw.currentCode, 10) || 0;
    const latestCode = parseInt(raw.latestCode, 10) || 0;
    const checkedAt = parseInt(raw.checkedAt, 10) || 0;
    if (!origin || !latestCode || !checkedAt) return null;
    return {
        origin,
        currentCode,
        latestCode,
        checkedAt,
        currentName: String(raw.currentName || ""),
        versionName: String(raw.versionName || ""),
    };
}

// Blocking "Checking for an update" splash: first run, unknown origin,
// or we already know this install is behind. A *passing* cache must not
// splash — and must not skip the network (a same-day APK used to stay
// invisible for 24h when the cache skipped the fetch).
export function apkGateShouldSplash(cache, {origin} = {}) {
    if (!cache || !origin || cache.origin !== origin) return true;
    if (isApkOutdated(cache.currentCode, cache.latestCode)) return true;
    return false;
}

// @deprecated use apkGateShouldSplash — kept so older tests/imports keep working.
export function apkGateNeedsCheck(cache, opts) {
    return apkGateShouldSplash(cache, opts);
}

export function apkGateCachedUpdate(cache, origin) {
    if (!cache || !origin || cache.origin !== origin) return null;
    if (!isApkOutdated(cache.currentCode, cache.latestCode)) return null;
    return cache;
}

export function loadApkGateCache() {
    try {
        return parseApkGateCache(JSON.parse(localStorage.getItem(APK_GATE_STORAGE_KEY) || "null"));
    } catch {
        return null;
    }
}

export function saveApkGateCache(record) {
    const parsed = parseApkGateCache(record);
    if (!parsed) return;
    try {
        localStorage.setItem(APK_GATE_STORAGE_KEY, JSON.stringify(parsed));
    } catch { /* private mode */ }
}

function initialApkGateState() {
    if (!isNativeApp()) return {status: "ready", update: null};
    const origin = getServerUrl();
    const cache = loadApkGateCache();
    const cached = apkGateCachedUpdate(cache, origin);
    if (cached) return {status: "outdated", update: cached};
    if (!apkGateShouldSplash(cache, {origin})) return {status: "ready", update: null};
    return {status: "checking", update: null};
}

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
    if (!resp?.ok || !info) return null;
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

const RECHECK_MS = 15 * 60 * 1000;

// Native only. Browser/PWA always `ready` (they already run the server's
// JS). A cold check must not mount the rest of the app: BottomNav + live
// queries would fire before we know this APK is allowed.
//
// A passing cache skips the *splash* so opening the app several times
// a day is not "Checking for an update" each time. The network check
// still runs on start, resume, and every 15 minutes — otherwise a
// same-day release stays invisible until tomorrow.
export function useApkGate() {
    const [state, setState] = useState(initialApkGateState);

    useEffect(() => {
        if (!isNativeApp()) return undefined;
        let alive = true;

        async function check() {
            pinNativeMediaOrigin();
            const origin = getServerUrl();
            try {
                const result = await readApkUpdate();
                if (!alive) return;
                if (result && origin) {
                    saveApkGateCache({...result, origin, checkedAt: Date.now()});
                }
                if (result && isApkOutdated(result.currentCode, result.latestCode)) {
                    setState({status: "outdated", update: result});
                } else if (result) {
                    setState({status: "ready", update: null});
                } else {
                    setState((prev) => (prev.status === "outdated" ? prev : {status: "ready", update: null}));
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
        const tick = setInterval(check, RECHECK_MS);
        return () => {
            alive = false;
            clearInterval(tick);
            if (typeof stop === "function") stop();
        };
    }, []);

    return state;
}

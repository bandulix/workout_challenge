import {useEffect, useState} from "react";
import {Capacitor, CapacitorHttp, registerPlugin} from "@capacitor/core";
import {getServerUrl, isNativeApp} from "./serverUrl";
import {ensureFreshAccessToken, getAccessToken, refreshAccessToken} from "./authTokens";
import {matchingImageCacheKeys} from "./queryPage";

const CachedMedia = registerPlugin("CachedMedia");

function withSize(url, size) {
    if (!url || !size) return url;
    if (url.includes("size=")) return url;
    return url + (url.includes("?") ? "&" : "?") + "size=" + encodeURIComponent(size);
}

// Authenticated image loader for media that is NOT publicly reachable
// (e.g. uploaded persona profile pictures - copyright-safe by design).
// <img> tags can't send the JWT, so the file is fetched with the
// Authorization header and rendered from a local URL. Fetches are
// deduplicated module-wide so N avatar components share one request.

const cache = new Map(); // url -> Promise<localURL | null>

// Cap concurrent picture fetches so a feed of avatars doesn't look like
// an HTTP crawl (CrowdSec http-crawl-non_statics counts distinct paths).
const MAX_INFLIGHT = 4;
let inflight = 0;
const waiters = [];

function withSlot(fn) {
    return new Promise((resolve, reject) => {
        const run = () => {
            inflight += 1;
            Promise.resolve()
                .then(fn)
                .then(resolve, reject)
                .finally(() => {
                    inflight -= 1;
                    const next = waiters.shift();
                    if (next) next();
                });
        };
        if (inflight < MAX_INFLIGHT) run();
        else waiters.push(run);
    });
}

function authHeaders(token) {
    // Do not send Accept: image/*. DRF negotiates Accept before the
    // picture action runs; image/* does not match JSONRenderer and 406s
    // every avatar. Default */* is fine - the view returns a FileResponse.
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    // CapacitorHttp rides OkHttp, whose default UA ("okhttp/4.x") is on
    // some CrowdSec bad-user-agent lists. Speak like the rest of the app.
    if (isNativeApp()) headers["User-Agent"] = "WorkoutChallenge/1.0 (Android)";
    return headers;
}

async function authorizedGet(url) {
    await ensureFreshAccessToken();
    let token = getAccessToken();
    try {
        return await doGet(url, token);
    } catch (err) {
        if (!String(err?.message || "").includes("HTTP 401")) throw err;
        const status = await refreshAccessToken();
        if (status !== "ok") throw err;
        return await doGet(url, getAccessToken());
    }
}

async function doGet(url, token) {
    if (isNativeApp()) return fetchNative(url, token);
    return fetchBrowser(url, token);
}

// Browser/PWA: same-origin fetch, rendered from a blob: object URL.
async function fetchBrowser(url, token) {
    const res = await fetch(getServerUrl() + url, {
        headers: authHeaders(token),
        cache: "no-cache",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
}

// Native app: the WebView's fetch is avoided entirely. CapacitorHttp goes
// through native OkHttp (no CORS preflight, no WebView cookie/header
// quirks - the same request curl makes), and the image is rendered from
// a data: URL because blob: object URLs are unreliable inside the
// Capacitor WebView with the https app scheme.
async function fetchNativeCached(url, token) {
    if (!isNativeApp() || !Capacitor.isPluginAvailable("CachedMedia")) return null;
    try {
        const origin = getServerUrl();
        const res = await CachedMedia.get({
            url: origin + url,
            origin,
            token: token || "",
        });
        const path = res?.src;
        if (!path) return null;
        return Capacitor.convertFileSrc(path);
    } catch {
        return null;
    }
}

async function fetchNative(url, token) {
    const cached = await fetchNativeCached(url, token);
    if (cached) return cached;
    const resp = await CapacitorHttp.get({
        url: getServerUrl() + url,
        headers: authHeaders(token),
        responseType: "blob",
    });
    if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
    // The native bridge returns binary bodies as a base64 STRING
    // (HttpRequestHandler.readStreamAsBase64), not a Blob - feeding it to
    // FileReader.readAsDataURL throws a TypeError and the avatar silently
    // falls back to the placeholder. Build the data: URL directly. The
    // Android encoder wraps lines (Base64.DEFAULT), so strip whitespace.
    if (typeof resp.data === "string") {
        const headers = resp.headers || {};
        const contentType = headers["Content-Type"] || headers["content-type"] || "image/jpeg";
        return `data:${contentType.split(";")[0].trim()};base64,${resp.data.replace(/\s/g, "")}`;
    }
    // Web implementation fallback: a real Blob goes through FileReader.
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(resp.data);
    });
}

export function fetchProtectedImage(url, size) {
    // The URL comes from an API payload. The request carries the JWT, so
    // it must only ever go to same-origin relative paths - otherwise a
    // malicious payload could point the authenticated fetch at an
    // attacker-controlled host and leak the token.
    if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) {
        return Promise.resolve(null);
    }
    const path = withSize(url, size);
    if (!cache.has(path)) {
        const promise = withSlot(() => authorizedGet(path))
            .catch(() => {
                // Drop failed fetches so the next mount retries (e.g. once
                // a fresh access token exists after a background refresh).
                cache.delete(path);
                return null;
            });
        cache.set(path, promise);
    }
    return cache.get(path);
}

// Drop a cached image (e.g. after the user/persona re-uploaded their
// picture): the URL is stable, so without this the old blob would be
// served until a full page reload.
export function cacheKeysFor(url) {
    return matchingImageCacheKeys(cache.keys(), url);
}

export function invalidateProtectedImage(url) {
    const keys = cacheKeysFor(url);
    for (const key of keys) {
        const entry = cache.get(key);
        cache.delete(key);
        Promise.resolve(entry).then((localUrl) => {
            if (typeof localUrl === "string" && localUrl.startsWith("blob:")) {
                URL.revokeObjectURL(localUrl);
            }
        }).catch(() => { /* best effort */ });
    }
    if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")
            && isNativeApp() && Capacitor.isPluginAvailable("CachedMedia")) {
        const origin = getServerUrl();
        const prefix = url.split("?")[0];
        CachedMedia.invalidate({url: origin + prefix, origin}).catch(() => {});
        CachedMedia.invalidate({url: origin + prefix + "?size=card", origin}).catch(() => {});
        CachedMedia.invalidate({url: origin + prefix + "?size=avatar", origin}).catch(() => {});
    }
}

export function clearProtectedImageCache() {
    for (const key of [...cache.keys()]) {
        invalidateProtectedImage(key);
    }
    cache.clear();
    if (isNativeApp() && Capacitor.isPluginAvailable("CachedMedia")) {
        CachedMedia.clear().catch(() => {});
    }
}

export function pinNativeMediaOrigin() {
    if (!isNativeApp() || !Capacitor.isPluginAvailable("CachedMedia")) return;
    const origin = getServerUrl();
    if (origin) CachedMedia.setOrigin({origin}).catch(() => {});
}

// Returns {src, failed}: src is the local URL once loaded (null while
// loading or when url is null), failed flips true when the fetch did not
// produce an image (caller falls back to default artwork).
export function useProtectedImage(url, size) {
    const [state, setState] = useState({src: null, failed: false});

    useEffect(() => {
        if (!url) {
            // Picture removed - reset instead of keeping the stale image.
            setState({src: null, failed: false});
            return;
        }
        let alive = true;
        setState({src: null, failed: false});
        fetchProtectedImage(url, size).then((localUrl) => {
            if (!alive) return;
            setState(localUrl ? {src: localUrl, failed: false} : {src: null, failed: true});
        });
        return () => {
            alive = false;
        };
    }, [url, size]);

    return state;
}

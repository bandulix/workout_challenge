import {useEffect, useState} from "react";
import {CapacitorHttp} from "@capacitor/core";
import {getServerUrl, isNativeApp} from "./serverUrl";

// Authenticated image loader for media that is NOT publicly reachable
// (e.g. uploaded persona profile pictures - copyright-safe by design).
// <img> tags can't send the JWT, so the file is fetched with the
// Authorization header and rendered from a local URL. Fetches are
// deduplicated module-wide so N avatar components share one request.

const cache = new Map(); // url -> Promise<localURL | null>

// Browser/PWA: same-origin fetch, rendered from a blob: object URL.
async function fetchBrowser(url, token) {
    const res = await fetch(getServerUrl() + url, {
        headers: token ? {Authorization: `Bearer ${token}`} : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
}

// Native app: the WebView's fetch is avoided entirely. CapacitorHttp goes
// through native OkHttp (no CORS preflight, no WebView cookie/header
// quirks - the same request curl makes), and the image is rendered from
// a data: URL because blob: object URLs are unreliable inside the
// Capacitor WebView with the https app scheme.
async function fetchNative(url, token) {
    const resp = await CapacitorHttp.get({
        url: getServerUrl() + url,
        headers: token ? {Authorization: `Bearer ${token}`} : {},
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

export function fetchProtectedImage(url) {
    // The URL comes from an API payload. The request carries the JWT, so
    // it must only ever go to same-origin relative paths - otherwise a
    // malicious payload could point the authenticated fetch at an
    // attacker-controlled host and leak the token.
    if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) {
        return Promise.resolve(null);
    }
    if (!cache.has(url)) {
        const token = localStorage.getItem("access_token");
        const promise = (isNativeApp() ? fetchNative(url, token) : fetchBrowser(url, token))
            .catch(() => {
                // Drop failed fetches so the next mount retries (e.g. once
                // a fresh access token exists after a background refresh).
                cache.delete(url);
                return null;
            });
        cache.set(url, promise);
    }
    return cache.get(url);
}

// Returns {src, failed}: src is the local URL once loaded (null while
// loading or when url is null), failed flips true when the fetch did not
// produce an image (caller falls back to default artwork).
export function useProtectedImage(url) {
    const [state, setState] = useState({src: null, failed: false});

    useEffect(() => {
        if (!url) return;
        let alive = true;
        setState({src: null, failed: false});
        fetchProtectedImage(url).then((localUrl) => {
            if (!alive) return;
            setState(localUrl ? {src: localUrl, failed: false} : {src: null, failed: true});
        });
        return () => {
            alive = false;
        };
    }, [url]);

    return state;
}

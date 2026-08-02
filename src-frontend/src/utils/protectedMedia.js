import {useEffect, useState} from "react";

// Authenticated image loader for media that is NOT publicly reachable
// (e.g. uploaded persona profile pictures - copyright-safe by design).
// <img> tags can't send the JWT, so the file is fetched with the
// Authorization header and rendered from an object URL. Fetches are
// deduplicated module-wide so N avatar components share one request.

const cache = new Map(); // url -> Promise<objectURL | null>

export function fetchProtectedImage(url) {
    if (!cache.has(url)) {
        const token = localStorage.getItem("access_token");
        const promise = fetch(url, {
            headers: token ? {Authorization: `Bearer ${token}`} : {},
        })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.blob();
            })
            .then((blob) => URL.createObjectURL(blob))
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

// Returns {src, failed}: src is the object URL once loaded (null while
// loading or when url is null), failed flips true when the fetch did not
// produce an image (caller falls back to default artwork).
export function useProtectedImage(url) {
    const [state, setState] = useState({src: null, failed: false});

    useEffect(() => {
        if (!url) return;
        let alive = true;
        setState({src: null, failed: false});
        fetchProtectedImage(url).then((objectUrl) => {
            if (!alive) return;
            setState(objectUrl ? {src: objectUrl, failed: false} : {src: null, failed: true});
        });
        return () => {
            alive = false;
        };
    }, [url]);

    return state;
}

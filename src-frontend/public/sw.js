/* Workout Challenge service worker
 *
 * Strategy: "online = realtime, cache = offline fallback only".
 *   - Every same-origin GET goes to the NETWORK FIRST, so while the
 *     device has a connection the app always shows live data and the
 *     current build - never a stale cached copy.
 *   - Only when the network FAILS (offline / lie-fi) do we fall back
 *     to the last cached copy:
 *       HTML navigations -> cached app shell, then /offline.html
 *       GET /api/*       -> last cached API response
 *       static assets    -> last cached asset
 *   - Successful responses refresh the cache in the background, so the
 *     offline fallback is always the freshest version this device saw.
 *   - Special case "stale chunk": if the server no longer has a static
 *     asset (old hashed JS/CSS after a redeploy) we serve the cached
 *     copy instead of the 404, so a long-open tab keeps working.
 *
 * Caches are long-lived runtime caches trimmed by entry count - they are
 * intentionally NOT deleted on each release. Purging versioned caches on
 * activate was what broke tabs that stayed open across a deployment
 * (their chunk URLs vanished -> "please refresh" errors).
 */

const SHELL_CACHE = "wc-shell";
const ASSET_CACHE = "wc-assets";
const API_CACHE = "wc-api";
const KNOWN_CACHES = [SHELL_CACHE, ASSET_CACHE, API_CACHE];

// Hygiene limits - oldest entries are evicted beyond these counts.
const ASSET_CACHE_LIMIT = 200;
const API_CACHE_LIMIT = 100;

const SHELL_URLS = [
    "/",
    "/index.html",
    "/offline.html",
    "/manifest.json",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-512.png",
    "/icon-badge.png",
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/fonts/fonts.css",
    "/fonts/Inter-var.woff2",
    "/fonts/ArchivoBlack-400.woff2",
    "/personas/megaphone.svg",
    "/personas/sergeant.svg",
    "/personas/roast.svg",
    "/personas/cheerleader.svg",
    "/personas/butler.svg",
    "/personas/zen.svg",
    "/personas/rocket.svg",
    "/personas/ninja.svg",
    "/personas/robot.svg",
    "/personas/captain.svg",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        // Remove only legacy/unknown caches (e.g. the old per-release
        // "wc-v2-*" ones). The current runtime caches survive every
        // update so long-open tabs never lose their assets mid-session.
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => !KNOWN_CACHES.includes(k)).map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const {request} = event;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Never cache cross-origin or non-HTTP requests (push notifications
    // and any future third-party APIs stay uncached).
    if (url.origin !== self.location.origin) return;

    // API: realtime while online; last cached response only when offline.
    if (url.pathname.startsWith("/api/")) {
        event.respondWith(apiHandler(request, event));
        return;
    }

    // HTML navigations: fresh shell while online; cached shell, then the
    // offline page when the network is down.
    if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
        event.respondWith(navigationHandler(request, event));
        return;
    }

    // Static assets: fresh while online; cached copy when offline OR when
    // the server no longer has the file (stale chunk after a redeploy).
    event.respondWith(assetHandler(request, event));
});

async function navigationHandler(request, event) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
            // All SPA routes serve the same index.html - store it under a
            // single stable key so the cache isn't filled with one entry
            // per route URL.
            cache.put("/", fresh.clone());
        }
        return fresh;
    } catch (err) {
        const cached = (await cache.match("/")) || (await cache.match("/index.html"));
        if (cached) return cached;
        const offline = await cache.match("/offline.html");
        if (offline) return offline;
        return new Response("Offline", {status: 503, statusText: "Offline"});
    }
}

async function apiHandler(request, event) {
    const cache = await caches.open(API_CACHE);
    try {
        const fresh = await fetch(request);
        // Cache successful responses as the offline fallback. Error
        // responses (4xx/5xx) are passed through untouched - the server
        // is the source of truth, stale data must never mask an error.
        if (fresh && fresh.ok && fresh.type !== "opaqueredirect") {
            cache.put(request, fresh.clone());
            event.waitUntil(trimCache(API_CACHE, API_CACHE_LIMIT));
        }
        return fresh;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

async function assetHandler(request, event) {
    const cache = await caches.open(ASSET_CACHE);
    try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
            cache.put(request, fresh.clone());
            event.waitUntil(trimCache(ASSET_CACHE, ASSET_CACHE_LIMIT));
            return fresh;
        }
        // Server answered but doesn't (any longer) have this asset - a
        // long-open tab asking for its old hashed chunk after a redeploy.
        // Keep it alive with the cached copy if we have one.
        const cached = await cache.match(request);
        if (cached) return cached;
        return fresh;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response("Offline", {status: 503, statusText: "Offline"});
    }
}

// Oldest-first eviction by entry count. Cache API keys() come back in
// insertion order, so deleting from the front approximates LRU well
// enough for hygiene purposes.
async function trimCache(cacheName, maxItems) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        if (keys.length > maxItems) {
            await Promise.all(keys.slice(0, keys.length - maxItems).map((k) => cache.delete(k)));
        }
    } catch (err) {
        // Trimming is best-effort housekeeping - never break a request over it.
    }
}

// ---- Push notifications (Drill Instructor MVP) ----------------------
// The server POSTs a JSON body {title, body, url} here when a new
// comment is posted. The user subscribed to push via the Subscribe
// button on the Site Settings page.

self.addEventListener("push", (event) => {
    let payload = {title: "Workout Challenge", body: "You have a new update.", url: "/", icon: null, badge: null, tag: null};
    if (event.data) {
        try {
            payload = {...payload, ...event.data.json()};
        } catch (e) {
            payload.body = event.data.text();
        }
    }
    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            // The coach's face (persona artwork) when provided; app bolt otherwise.
            icon: payload.icon || "/icon-192.png",
            badge: payload.badge || "/icon-badge.png",
            tag: payload.tag || "workout-challenge",
            renotify: Boolean(payload.tag),
            data: {url: payload.url || "/"},
            vibrate: [100, 50, 100],
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = event.notification.data?.url || "/";
    event.waitUntil(
        self.clients.matchAll({type: "window", includeUncontrolled: true}).then((wins) => {
            // Only navigate / open a window for same-origin URLs. Any
            // cross-origin target is silently ignored to prevent the
            // push payload from turning into an open redirect.
            const url = new URL(target, self.location.origin);
            if (url.origin !== self.location.origin) return;
            for (const w of wins) {
                if ("focus" in w) {
                    w.navigate(url.pathname + url.search + url.hash);
                    return w.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(url.pathname + url.search + url.hash);
        })
    );
});

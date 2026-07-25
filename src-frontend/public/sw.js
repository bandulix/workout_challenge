/* Workout Challenge service worker
 *
 * Strategy:
 *   - HTML navigations: network-first, fall back to cached shell, then /offline.html.
 *   - GET /api/* : network-first with 5s timeout, fall back to cached response if offline.
 *   - Static assets (JS/CSS/images/fonts): cache-first, revalidate in background.
 *
 * Bump CACHE_VERSION on each release to invalidate stale assets.
 */

const CACHE_VERSION = "wc-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SHELL_URLS = [
    "/",
    "/index.html",
    "/offline.html",
    "/manifest.json",
    "/icon-192.svg",
    "/icon-512.svg",
    "/maskable-icon.svg",
    "/favicon.ico",
    "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const {request} = event;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Never cache the Matrix outbound API; never cache non-HTTP.
    if (url.origin !== self.location.origin) return;

    // API: network-first with short timeout, cached fallback.
    if (url.pathname.startsWith("/api/")) {
        event.respondWith(networkFirst(request, API_CACHE, 5000));
        return;
    }

    // HTML navigations: network-first, shell fallback, offline page.
    if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
        event.respondWith(navigationHandler(request));
        return;
    }

    // Static assets: cache-first with background revalidation.
    event.respondWith(cacheFirst(request, ASSET_CACHE));
});

async function navigationHandler(request) {
    try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, fresh.clone());
        return fresh;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        const offline = await caches.match("/offline.html");
        if (offline) return offline;
        return new Response("Offline", {status: 503, statusText: "Offline"});
    }
}

async function networkFirst(request, cacheName, timeoutMs) {
    const cache = await caches.open(cacheName);
    try {
        const fresh = await Promise.race([
            fetch(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
        ]);
        // Only cache successful, non-opaque responses.
        if (fresh && fresh.ok && fresh.type !== "opaqueredirect") {
            cache.put(request, fresh.clone());
        }
        return fresh;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
        // Background revalidate.
        fetch(request).then((fresh) => {
            if (fresh && fresh.ok) cache.put(request, fresh.clone());
        }).catch(() => {});
        return cached;
    }
    try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) cache.put(request, fresh.clone());
        return fresh;
    } catch (err) {
        return new Response("Offline", {status: 503, statusText: "Offline"});
    }
}

// ---- Push notifications (Drill Instructor MVP) ----------------------
// The server POSTs a JSON body {title, body, url} here when a new
// comment is posted. The user subscribed to push via the Subscribe
// button on the Site Settings page.

self.addEventListener("push", (event) => {
    let payload = {title: "Workout Challenge", body: "You have a new update.", url: "/"};
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
            icon: "/icon-192.svg",
            badge: "/icon-192.svg",
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
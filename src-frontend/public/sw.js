/* Workout Challenge service worker
 *
 * Strategy: "online = realtime, cache = offline fallback only".
 * - Every same-origin GET goes to the NETWORK FIRST, so while the
 *   device has a connection the app always shows live data and the
 *   current build - never a stale cached copy.
 * - Only when the network FAILS (offline / lie-fi) do we fall back
 *   to the last cached copy:
 *     HTML navigations -> cached app shell, then /offline.html
 *     static assets    -> last cached asset
 * - /api/ is NEVER cached (issue #20): authenticated GETs must not
 *   linger in Cache Storage on shared devices. ApiNoStoreMiddleware
 *   already sends Cache-Control: no-store; we honor that here too.
 * - Successful non-API responses refresh the cache in the background.
 * - Special case "stale chunk": if the server no longer has a static
 *   asset (old hashed JS/CSS after a redeploy) we serve the cached
 *   copy instead of the 404, so a long-open tab keeps working.
 *
 * Caches are long-lived runtime caches trimmed by entry count - they are
 * intentionally NOT deleted on each release. Purging versioned caches on
 * activate was what broke tabs that stayed open across a deployment
 * (their chunk URLs vanished -> "please refresh" errors).
 */

const SHELL_CACHE = "wc-shell";
const ASSET_CACHE = "wc-assets";
// Legacy name from when authenticated /api/ GETs were cached offline.
// Kept so activate + logout can delete any leftover entries.
const API_CACHE = "wc-api";
const KNOWN_CACHES = [SHELL_CACHE, ASSET_CACHE];

// Hygiene limits - oldest entries are evicted beyond these counts.
const ASSET_CACHE_LIMIT = 200;

const SHELL_URLS = [
  "/",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      for (const url of SHELL_URLS) {
        try {
          await cache.add(url);
        } catch {
          /* offline during install is fine; runtime path fills in */
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Remove legacy/unknown caches (including pre-#20 wc-api) so
    // authenticated API responses cannot linger on shared devices.
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !KNOWN_CACHES.includes(k)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data && data.type === "CLEAR_API_CACHE") {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const {request} = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // API: network-only. Do not read or write Cache Storage for /api/
  // (issue #20). Honor Cache-Control: no-store from the backend.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(apiHandler(request));
    return;
  }

  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(navigationHandler(request, event));
    return;
  }

  event.respondWith(assetHandler(request, event));
});

async function navigationHandler(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
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

function cacheControlForbidsStore(response) {
  const cc = (response.headers.get("Cache-Control") || "").toLowerCase();
  return cc.includes("no-store") || cc.includes("no-cache");
}

async function apiHandler(request) {
  // Network-only: never populate Cache Storage with /api/ responses.
  try {
    return await fetch(request);
  } catch (err) {
    return new Response(JSON.stringify({detail: "Offline"}), {
      status: 503,
      statusText: "Offline",
      headers: {"Content-Type": "application/json", "Cache-Control": "no-store"},
    });
  }
}

async function assetHandler(request, event) {
  const cache = await caches.open(ASSET_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && !cacheControlForbidsStore(fresh)) {
      cache.put(request, fresh.clone());
      event.waitUntil(trimCache(ASSET_CACHE, ASSET_CACHE_LIMIT));
      return fresh;
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("Offline", {status: 503, statusText: "Offline"});
  }
}

async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      await Promise.all(keys.slice(0, keys.length - maxItems).map((k) => cache.delete(k)));
    }
  } catch (err) {
    // best-effort
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {title: "Workout Challenge", body: "You have a new update.", url: "/", icon: null, badge: null, tag: null};
    if (event.data) {
      try {
        payload = {...payload, ...event.data.json()};
      } catch (e) {
        payload.body = event.data.text();
      }
    }
    const tag = payload.tag || "workout-challenge";
    let alreadyShowing = false;
    try {
      const existing = await self.registration.getNotifications({tag});
      alreadyShowing = existing.length > 0;
    } catch (err) {
      alreadyShowing = false;
    }
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/icon-192.png",
      badge: payload.badge || "/icon-badge.png",
      tag,
      renotify: Boolean(payload.tag) && !alreadyShowing,
      data: {url: payload.url || "/"},
      vibrate: alreadyShowing ? [] : [100, 50, 100],
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({type: "window", includeUncontrolled: true}).then((wins) => {
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

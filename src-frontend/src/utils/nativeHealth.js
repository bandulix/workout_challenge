import {Capacitor, registerPlugin} from "@capacitor/core";

// Bridge to the native OWHealthPlugin (Kotlin) - only functional inside
// the Android app; in the browser the plugin proxy rejects, so every
// call must be gated behind isNativeHealthAvailable().
const OWHealth = registerPlugin("OWHealth");
const HEALTH_HOST_KEY = "wc_health_host";

export function isNativeHealthAvailable() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

// Same bar as the native HealthHost.kt check: http(s) with a hostname
// and no embedded credentials. Stops javascript:/file: and userinfo
// hosts from ever reaching fetch() or the OW SDK.
export function isAllowedHealthHost(host) {
    if (!host || typeof host !== "string") return false;
    try {
        const url = new URL(host.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:") return false;
        if (!url.hostname) return false;
        if (url.username || url.password) return false;
        return true;
    } catch {
        return false;
    }
}

function rememberHealthHost(host) {
    if (!isAllowedHealthHost(host)) return "";
    try { localStorage.setItem(HEALTH_HOST_KEY, host.trim()); } catch { /* private mode */ }
    return host.trim();
}

function resolveHealthHost(publicUrl) {
    const fromServer = (publicUrl || "").trim();
    let stored = "";
    try { stored = (localStorage.getItem(HEALTH_HOST_KEY) || "").trim(); } catch { stored = ""; }
    if (fromServer && isAllowedHealthHost(fromServer)) {
        if (stored && isAllowedHealthHost(stored)) {
            try {
                if (new URL(stored).origin !== new URL(fromServer).origin) {
                    try { localStorage.removeItem(HEALTH_HOST_KEY); } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        }
        return fromServer;
    }
    return isAllowedHealthHost(stored) ? stored : "";
}

// One-tap Health Connect onboarding for the Android app: our backend
// already issued the single-use invitation code (health/link); we redeem
// it against the public OW endpoint ourselves and hand the resulting SDK
// tokens to the native SDK, then request permissions and start sync.
export async function nativeHealthConnect({code, host}) {
    if (!isAllowedHealthHost(host)) {
        throw new Error("The health server address is not a valid http(s) URL.");
    }
    const safeHost = host.trim().replace(/\/+$/, "");
    let resp;
    try {
        resp = await fetch(`${safeHost}/api/v1/invitation-code/redeem`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({code}),
        });
    } catch (e) {
        // TypeError = fetch never got a response: DNS ("host not found"),
        // offline, or an HTTP host mixed-content-blocked under the HTTPS
        // app. Name the cause so the fix is obvious.
        throw new Error(
            `The health server can't be reached (${safeHost}). ` +
            "Check your internet connection - or, if you run the server, its Health public address (Site Settings)."
        );
    }
    if (!resp.ok) {
        throw new Error("The connection code was rejected by the health server.");
    }
    const {user_id, access_token, refresh_token} = await resp.json();

    await OWHealth.configure({host: safeHost});
    rememberHealthHost(safeHost);
    await OWHealth.signIn({userId: user_id, accessToken: access_token, refreshToken: refresh_token});

    const {granted} = await OWHealth.requestHealthAuthorization();
    if (!granted) {
        throw new Error("Health Connect permissions were not granted.");
    }
    await OWHealth.startSync({daysBack: 43});
}

// Keep the native background sync in step with the selected activity
// source: 'health' -> sync runs, anything else -> sync paused (the
// server would skip the imports anyway, but the phone should not burn
// battery pushing them). Covers switches made on other devices too.
export async function nativeHealthSetSource(source, publicUrl) {
    try {
        // The OW SDK only auto-restores WorkManager after configure().
        // That used to run solely at link time, so after a process
        // kill Health Connect stopped pushing and the hourly server
        // poll had nothing to import. Prefer the server-provided URL
        // so a poisoned localStorage host cannot keep winning.
        const host = resolveHealthHost(publicUrl);
        if (host) {
            await OWHealth.configure({host});
            rememberHealthHost(host);
        }
        const status = await OWHealth.getStatus();
        if (!status.sessionValid) return; // never linked natively
        if (source === "health") {
            // Re-ask every launch so newly added types (distance) get a
            // Health Connect dialog for already-linked installs. Already
            // granted types resolve silently.
            try {
                await OWHealth.requestHealthAuthorization();
            } catch (e) {
                console.warn("Health Connect authorization refresh failed", e);
            }
            // isSyncActive can stay true after a process kill even
            // though WorkManager is gone. Catch up once per JS session
            // (covers that stale flag); later refetches only re-arm
            // when the SDK itself reports sync as stopped.
            let catchup = false;
            try {
                catchup = !sessionStorage.getItem("wc_health_catchup");
                if (catchup) sessionStorage.setItem("wc_health_catchup", "1");
            } catch {
                catchup = true;
            }
            if (catchup || !status.syncActive) {
                await OWHealth.startSync(catchup ? {daysBack: 43} : {});
            }
        } else if (status.syncActive) {
            await OWHealth.stopSync();
        }
    } catch (e) {
        console.warn("native source reconcile failed (ignored)", e);
    }
}

// Push Health Connect to Open Wearables *now* and wait until the
// upload returns. startBackgroundSync only schedules WorkManager, so a
// Re-Sync that then polls the server always raced an empty store.
// Best-effort: a missing native session is a no-op (the server poll
// still runs).
export async function nativeHealthKickSync({daysBack, publicUrl} = {}) {
    if (!isNativeHealthAvailable()) return {ok: false, reason: "not-native"};
    try {
        const host = resolveHealthHost(publicUrl || "");
        if (host) {
            await OWHealth.configure({host});
        }
        const status = await OWHealth.getStatus();
        if (!status.sessionValid) return {ok: false, reason: "no-session"};
        await OWHealth.syncNow(daysBack != null ? {daysBack} : {});
        return {ok: true};
    } catch (e) {
        console.warn("native health kick failed (ignored)", e);
        return {ok: false, reason: "error"};
    }
}

export async function nativeHealthDisconnect() {
    // Best-effort: a stale native session must not block an unlink.
    try { localStorage.removeItem(HEALTH_HOST_KEY); } catch { /* ignore */ }
    try {
        await OWHealth.signOut();
    } catch (e) {
        console.warn("native signOut failed (ignored)", e);
    }
}

import {Capacitor, registerPlugin} from "@capacitor/core";

// Bridge to the native OWHealthPlugin (Kotlin) - only functional inside
// the Android app; in the browser the plugin proxy rejects, so every
// call must be gated behind isNativeHealthAvailable().
const OWHealth = registerPlugin("OWHealth");
const HEALTH_HOST_KEY = "wc_health_host";

export function isNativeHealthAvailable() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

// One-tap Health Connect onboarding for the Android app: our backend
// already issued the single-use invitation code (health/link); we redeem
// it against the public OW endpoint ourselves and hand the resulting SDK
// tokens to the native SDK, then request permissions and start sync.
export async function nativeHealthConnect({code, host}) {
    let resp;
    try {
        resp = await fetch(`${host}/api/v1/invitation-code/redeem`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({code}),
        });
    } catch (e) {
        // TypeError = fetch never got a response: DNS ("host not found"),
        // offline, or an HTTP host mixed-content-blocked under the HTTPS
        // app. Name the cause so the fix is obvious.
        throw new Error(
            `The health server can't be reached (${host}). ` +
            "Check your internet connection - or, if you run the server, its Health public address (Site Settings)."
        );
    }
    if (!resp.ok) {
        throw new Error("The connection code was rejected by the health server.");
    }
    const {user_id, access_token, refresh_token} = await resp.json();

    await OWHealth.configure({host});
    try { localStorage.setItem(HEALTH_HOST_KEY, host); } catch { /* private mode */ }
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
        // poll had nothing to import.
        const host = (localStorage.getItem(HEALTH_HOST_KEY) || publicUrl || "").trim();
        if (host) {
            await OWHealth.configure({host});
            try { localStorage.setItem(HEALTH_HOST_KEY, host); } catch { /* private mode */ }
        }
        const status = await OWHealth.getStatus();
        if (!status.sessionValid) return; // never linked natively
        if (source === "health") {
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
export async function nativeHealthKickSync({daysBack} = {}) {
    if (!isNativeHealthAvailable()) return {ok: false, reason: "not-native"};
    try {
        const host = (localStorage.getItem(HEALTH_HOST_KEY) || "").trim();
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

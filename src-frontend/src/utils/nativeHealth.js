import {Capacitor, registerPlugin} from "@capacitor/core";

// Bridge to the native OWHealthPlugin (Kotlin) - only functional inside
// the Android app; in the browser the plugin proxy rejects, so every
// call must be gated behind isNativeHealthAvailable().
const OWHealth = registerPlugin("OWHealth");

export function isNativeHealthAvailable() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

// One-tap Health Connect onboarding for the Android app: our backend
// already issued the single-use invitation code (health/link); we redeem
// it against the public OW endpoint ourselves and hand the resulting SDK
// tokens to the native SDK, then request permissions and start sync.
export async function nativeHealthConnect({code, host}) {
    const resp = await fetch(`${host}/api/v1/invitation-code/redeem`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({code}),
    });
    if (!resp.ok) {
        throw new Error("The connection code was rejected by the health server.");
    }
    const {user_id, access_token, refresh_token} = await resp.json();

    await OWHealth.configure({host});
    await OWHealth.signIn({userId: user_id, accessToken: access_token, refreshToken: refresh_token});

    const {granted} = await OWHealth.requestHealthAuthorization();
    if (!granted) {
        throw new Error("Health Connect permissions were not granted.");
    }
    await OWHealth.startSync({daysBack: 43});
}

export async function nativeHealthDisconnect() {
    // Best-effort: a stale native session must not block an unlink.
    try {
        await OWHealth.signOut();
    } catch (e) {
        console.warn("native signOut failed (ignored)", e);
    }
}

export async function nativeHealthStatus() {
    return OWHealth.getStatus();
}

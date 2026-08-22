import {LocalNotifications} from "@capacitor/local-notifications";
import {apiUrl, isNativeApp} from "./platform";

// Coach pings in the Android app. Web Push (VAPID) does not work inside
// an Android WebView, so the native app drives pings itself: it polls
// the coach feed (the backend talks to it anyway) and raises a real
// Android notification when a new coach message arrives. No server
// changes, no Firebase - local notifications only.
//
// Semantics:
//   - baseline on first run (no spam about history),
//   - only coach-authored kinds (activity comment, random group push,
//     quiet-day nudge, reply reaction) - never own replies or admin
//     test messages,
//   - silent without notification permission or when logged out.
const LAST_KEY = "wc_last_coach_msg_id";
const POLL_MS = 90000;
const NOTIFY_KINDS = new Set(["activity", "push", "nudge", "reaction"]);

async function fetchLatestCoachMessage() {
    const token = localStorage.getItem("access_token");
    if (!token) return null;
    const resp = await fetch(apiUrl("/drill-instructor/message/"), {
        headers: {Authorization: `Bearer ${token}`},
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const roots = Array.isArray(data) ? data : (data.results || []);

    // Candidates: coach-authored roots (comment/push/nudge) plus coach
    // reactions nested in threads (both share the same id sequence).
    let latest = null;
    for (const root of roots) {
        if (NOTIFY_KINDS.has(root.kind) && (!latest || root.id > latest.id)) latest = root;
        for (const reply of root.replies || []) {
            if (reply.is_coach && (!latest || reply.id > latest.id)) {
                latest = {...reply, persona_name: root.persona_name, competition_name: root.competition_name};
            }
        }
    }
    return latest;
}

async function ensurePermission() {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return true;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === "granted";
}

export function startNativeCoachPings() {
    if (!isNativeApp()) return () => {};

    let stopped = false;
    let timer = null;

    async function tick() {
        try {
            if (await ensurePermission()) {
                const latest = await fetchLatestCoachMessage();
                if (latest) {
                    const lastSeen = parseInt(localStorage.getItem(LAST_KEY) || "0", 10) || 0;
                    if (lastSeen === 0) {
                        // First run: remember the newest message, notify
                        // only about what arrives AFTER it.
                        localStorage.setItem(LAST_KEY, String(latest.id));
                    } else if (latest.id > lastSeen) {
                        localStorage.setItem(LAST_KEY, String(latest.id));
                        await LocalNotifications.schedule({
                            notifications: [{
                                id: latest.id,
                                title: latest.persona_name
                                    ? `${latest.persona_name}${latest.competition_name ? " · " + latest.competition_name : ""}`
                                    : "Your coach",
                                body: latest.body || "",
                            }],
                        });
                    }
                }
            }
        } catch (e) {
            // Offline / logged out / plugin missing - next tick retries.
        }
        if (!stopped) timer = setTimeout(tick, POLL_MS);
    }

    // Let the login settle before the first poll (and permission prompt).
    timer = setTimeout(tick, 10000);
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}

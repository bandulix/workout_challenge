import {LocalNotifications} from "@capacitor/local-notifications";
import {apiUrl, isNativeApp} from "./platform";
import {ensureFreshAccessToken, getAccessToken} from "./authTokens";
import {onAppResume} from "./appLifecycle";

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
const NOTIFY_KINDS = new Set(["activity", "push", "nudge", "reaction", "order", "sigh", "dunce", "handover", "echo", "claim", "war"]);
// One Android notification slot so a overlapping poll replaces instead
// of stacking two banners. Capacitor ids are int32.
const NOTIFY_ID = 71001;

async function fetchLatestCoachMessage() {
    const status = await ensureFreshAccessToken();
    if (status === "dead" || status === "none") return null;
    const token = getAccessToken();
    if (!token) return null;
    const resp = await fetch(apiUrl("/drill-instructor/message/"), {
        headers: {Authorization: `Bearer ${token}`},
        cache: "no-store",
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const roots = Array.isArray(data) ? data : (data.results || []);

    // Candidates: coach-authored roots plus coach reactions and (for
    // native) participant replies on your post / @mentions.
    let latest = null;
    for (const root of roots) {
        if (NOTIFY_KINDS.has(root.kind) && (!latest || root.id > latest.id)) {
            latest = {
                ...root,
                _url: feedUrl(root),
            };
        }
        for (const reply of root.replies || []) {
            const merged = {
                ...reply,
                persona_name: root.persona_name,
                competition_name: root.competition_name,
                competition_id: root.competition_id,
                parent_id: root.id,
                workout_user_id: root.workout_user_id,
                _url: feedUrl({...reply, competition_id: root.competition_id, parent_id: root.id}),
            };
            if (reply.is_coach && (!latest || reply.id > latest.id)) latest = merged;
            if (!reply.is_coach && (!latest || reply.id > latest.id)) latest = {...merged, _social: true};
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

function feedUrl(message) {
    const rootId = message.parent_id || message.id;
    const cid = message.competition_id;
    if (!cid) return "/coach";
    return `/competition/${cid}?tab=feed&reply=${rootId}`;
}

function mentionsName(body, firstName) {
    if (!body || !firstName) return false;
    const needle = firstName.trim().toLowerCase();
    return new RegExp(`@${needle}\\b`, "i").test(body);
}

export function startNativeCoachPings(user) {
    if (!isNativeApp()) return () => {};

    let stopped = false;
    let timer = null;
    let inflight = false;
    let clickHandle = null;
    LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
        const url = action?.notification?.extra?.url;
        if (url && typeof url === "string" && url.startsWith("/")) {
            window.dispatchEvent(new CustomEvent("wc-open", {detail: url}));
        }
    }).then((h) => { clickHandle = h; }).catch(() => {});

    async function tick() {
        if (stopped || inflight) return;
        inflight = true;
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
                        const social = latest._social;
                        const ownReply = user?.id && latest.author_id === user.id;
                        const mine = user?.id && latest.workout_user_id === user.id;
                        const tagged = mentionsName(latest.body, user?.first_name);
                        if (social && (ownReply || (!mine && !tagged))) {
                            // Someone else's reply that is not an @mention of you.
                        } else {
                            const title = social
                                ? (tagged ? "You were mentioned" : "New comment on your post")
                                : (latest.persona_name
                                    ? `${latest.persona_name}${latest.competition_name ? " · " + latest.competition_name : ""}`
                                    : "Your coach");
                            await LocalNotifications.schedule({
                                notifications: [{
                                    id: NOTIFY_ID,
                                    title,
                                    body: latest.body || "",
                                    extra: {url: latest._url || "/coach"},
                                }],
                            });
                        }
                    }
                }
            }
        } catch (e) {
            // Offline / logged out / plugin missing - next tick retries.
        } finally {
            inflight = false;
            if (!stopped) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(tick, POLL_MS);
            }
        }
    }

    // Let the login settle before the first poll (and permission prompt).
    timer = setTimeout(tick, 10000);
    const stopResume = onAppResume(() => {
        if (stopped) return;
        if (timer) clearTimeout(timer);
        tick();
    });
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        stopResume();
        clickHandle?.remove?.();
    };
}

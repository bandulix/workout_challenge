const NEW_ECHO_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_TAKEOVER_WINDOW_MS = 72 * 60 * 60 * 1000;

function withinWindow(value, now, windowMs) {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    const reference = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!Number.isFinite(timestamp) || !Number.isFinite(reference)) return false;
    const age = reference - timestamp;
    return age >= 0 && age <= windowMs;
}

/** Return only Echoes with a current story beat for the compact live surface. */
export function noteworthyEchoes(echoes, now = new Date()) {
    return (echoes || []).filter((echo) => (
        echo?.threatened === true
        || withinWindow(echo?.created_at, now, NEW_ECHO_WINDOW_MS)
        || withinWindow(echo?.last_claimed_at, now, RECENT_TAKEOVER_WINDOW_MS)
    ));
}

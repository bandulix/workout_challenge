/** A challenge is "running" from its start date through the end date (inclusive, plus the last calendar day). */
export function isChallengeRunning(c) {
    if (!c) return false;
    const now = Date.now() / 1000;
    if (c.start_date_epoch && now < c.start_date_epoch) return false;
    if (c.end_date_epoch && now > c.end_date_epoch + 86400) return false;
    return true;
}

/** Prefer the single running challenge; otherwise the only challenge. */
export function primaryChallenge(competitions) {
    const list = Array.isArray(competitions) ? competitions : Object.values(competitions || {});
    if (list.length === 0) return null;
    const running = list.filter(isChallengeRunning);
    if (running.length === 1) return running[0];
    if (list.length === 1) return list[0];
    return null;
}

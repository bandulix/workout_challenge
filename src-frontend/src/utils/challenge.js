/** Parse a YYYY-MM-DD (or Date) as a local calendar day. Avoids UTC-midnight off-by-one. */
function parseDateOnly(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfLocalDay(now) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole local calendar days from today until the inclusive end date. 0 = last day. */
export function daysUntilChallengeEnd(endDate, now = new Date()) {
    const end = parseDateOnly(endDate);
    if (!end) return null;
    return Math.round((end.getTime() - startOfLocalDay(now).getTime()) / 86400000);
}

export function challengeDaysLeftLabel(endDate, now = new Date()) {
    const days = daysUntilChallengeEnd(endDate, now);
    if (days == null) return "";
    if (days > 1) return `${days} days left`;
    if (days === 1) return "1 day left";
    if (days === 0) return "Last day";
    return "Ended";
}

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

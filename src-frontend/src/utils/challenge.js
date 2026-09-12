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

/** Chip for the challenge header: a date, Last day, or Ended — not a day-count argument. */
export function challengeEndChip(endDate, endDateFmt, now = new Date()) {
    const days = daysUntilChallengeEnd(endDate, now);
    if (days == null) return null;
    if (days < 0) return {kind: "ended", text: "Ended"};
    if (days === 0) return {kind: "last", text: "Last day"};
    const when = String(endDateFmt || "").trim();
    return {kind: "live", text: when ? `Ends ${when}` : `${days} day${days === 1 ? "" : "s"} left`};
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

const LAST_COMP_KEY = "wc_last_competition";
let lastCompetitionMemory = "";

export function rememberLastCompetition(pathname) {
    const match = /^\/competition\/(\d+)/.exec(String(pathname || "").replace(/\/+$/, "") || "/");
    if (!match) return;
    lastCompetitionMemory = match[1];
    try {
        window.localStorage.setItem(LAST_COMP_KEY, match[1]);
    } catch {
        /* private mode */
    }
}

/** Last opened challenge that the user still belongs to. */
export function lastChallenge(competitions) {
    const list = Array.isArray(competitions) ? competitions : Object.values(competitions || {});
    if (list.length === 0) return null;
    let stored = lastCompetitionMemory;
    try {
        stored = window.localStorage.getItem(LAST_COMP_KEY) || lastCompetitionMemory;
    } catch {
        /* keep memory */
    }
    return list.find((c) => String(c.id) === stored) || primaryChallenge(list) || list[0] || null;
}

/** Countdown math and snow copy for a ski week. No clock, so tests can pin `now`. */

export function countdownParts(startsAt, now = new Date()) {
    const start = new Date(startsAt);
    if (!startsAt || Number.isNaN(start.getTime())) return null;
    const remainingMs = start.getTime() - now.getTime();
    const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
    return {
        remainingMs,
        kickedOff: remainingMs <= 0,
        days: Math.floor(totalSeconds / 86400),
        hours: Math.floor((totalSeconds % 86400) / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
    };
}

/** Server phase, corrected the moment the local clock crosses the start. */
export function visiblePhase(skiweek, now = new Date()) {
    if (!skiweek?.enabled) return "off";
    if (skiweek.phase === "ended") return "ended";
    const parts = countdownParts(skiweek.starts_at, now);
    if (parts?.kickedOff) return "live";
    if (skiweek.phase === "live") return "live";
    return "prestart";
}

export function pad2(value) {
    return String(value).padStart(2, "0");
}

export function freshSnowCm(weather) {
    const cm = Number(weather?.fresh_snow_cm ?? weather?.snowfall_24h_cm);
    if (!Number.isFinite(cm) || cm < 1) return null;
    return Number.isInteger(cm) ? String(cm) : cm.toFixed(1);
}

export function snowingNow(weather) {
    return Boolean(weather?.is_snowing || weather?.mood === "snowing");
}

export function shareText(skiweek, now = new Date()) {
    const resort = skiweek?.resort?.name || "the Alps";
    const phase = visiblePhase(skiweek, now);
    const parts = countdownParts(skiweek?.starts_at, now);
    const fresh = freshSnowCm(skiweek?.weather);
    const snowLine = fresh ? ` ${fresh} cm fresh snow.` : "";
    if (phase === "live") return `${resort} is open.${snowLine}`;
    if (!parts) return `${resort} ski week.${snowLine}`;
    const dayWord = parts.days === 1 ? "day" : "days";
    return `${resort} ski week starts in ${parts.days} ${dayWord} ${pad2(parts.hours)}h ${pad2(parts.minutes)}m.${snowLine}`;
}

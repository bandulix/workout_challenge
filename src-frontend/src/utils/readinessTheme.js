/** Band colours and clock helpers shared by the readiness UI. */

export const READINESS_DISCLAIMER = "A training hint from your recent numbers, not medical advice.";

export const BAND_EDGE = {
    green: "#d7ff3e",
    amber: "#e6a317",
    red: "#e24b4b",
};

export const BAND_LABEL = {
    green: "Green",
    amber: "Amber",
    red: "Red",
};

export const TIMEZONES = [
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Auckland",
];

export function bandEdge(band) {
    return BAND_EDGE[band] || "";
}

export function minuteToClock(minute) {
    if (minute == null || minute === "") return "";
    const value = Number(minute);
    if (!Number.isFinite(value)) return "";
    const wrapped = ((value % 1440) + 1440) % 1440;
    const hours = Math.floor(wrapped / 60);
    const mins = wrapped % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function clockToMinute(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours > 23 || mins > 59) return null;
    return hours * 60 + mins;
}

export function timezoneChoices(current) {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const list = [];
    if (browser) list.push(browser);
    for (const zone of TIMEZONES) {
        if (!list.includes(zone)) list.push(zone);
    }
    if (current && !list.includes(current)) list.unshift(current);
    return list;
}

/** Personal order wins for this challenge. The group order stays the fallback. */
export function orderForHome(groupOrder, readiness, competitionId) {
    const orders = readiness?.orders || [];
    const hasChallenge = competitionId != null && competitionId !== "";
    if (hasChallenge) {
        const personal = orders.find((item) => String(item.competition_id) === String(competitionId))
            || (readiness?.order && String(readiness.order.competition_id) === String(competitionId) ? readiness.order : null);
        if (personal?.brief) return personal;
        return groupOrder || null;
    }
    const personal = (readiness?.order?.brief && readiness.order) || orders.find((item) => item?.brief);
    if (personal?.brief) return personal;
    return groupOrder || null;
}

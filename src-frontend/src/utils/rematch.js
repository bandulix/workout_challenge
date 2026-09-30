function parseLocalDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        ? date
        : null;
}

function dateForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function buildRematchSeed(competition, now = new Date()) {
    const oldStart = parseLocalDate(competition?.start_date);
    const oldEnd = parseLocalDate(competition?.end_date);
    const windowDays = oldStart && oldEnd && oldEnd >= oldStart
        ? Math.round((oldEnd - oldStart) / 86400000)
        : 29;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + windowDays);

    const name = typeof competition?.name === "string" && competition.name.trim()
        ? competition.name.trim()
        : "Challenge";

    return {
        name: `${name} · Rematch`,
        start_date: dateForInput(start),
        end_date: dateForInput(end),
        has_teams: Boolean(competition?.has_teams),
        organizer_assigns_teams: Boolean(competition?.organizer_assigns_teams),
        // Same game mode, but a fresh route: blank theme = "surprise me",
        // which the server resolves to a route this organizer hasn't run.
        expedition_enabled: Boolean(competition?.expedition_enabled),
        expedition_objective: competition?.expedition_objective || "expedition",
        expedition_theme: "",
    };
}

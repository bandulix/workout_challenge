/** Shared helpers for paged API payloads and tiny predicates used in tests. */

export function pageResults(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return Array.isArray(data.results) ? data.results : [];
}

export function matchingImageCacheKeys(keys, url) {
    if (typeof url !== "string" || !url) return [];
    const prefix = url.split("?")[0];
    return [...keys].filter(
        (key) => key === url || key === prefix || key.startsWith(prefix + "?"),
    );
}

export function isApkOutdated(currentCode, latestCode) {
    const current = parseInt(currentCode, 10) || 0;
    const latest = parseInt(latestCode, 10) || 0;
    return latest > 0 && latest > current;
}

export function scoreGoals(goals, feed, userId, user) {
    if (!goals?.length || !userId) return [];

    const scale = (goal) => {
        if (["kcal", "kj"].includes(goal.metric)) return user?.scaling_kcal ?? 1;
        if (goal.metric === "km") return user?.scaling_distance ?? 1;
        return 1;
    };

    const totals = feed && !Array.isArray(feed) ? feed.my_goal_points : null;
    if (totals && typeof totals === "object") {
        return goals.map((goal) => ({
            ...goal,
            goal: goal.goal * scale(goal),
            points_capped: Number(totals[goal.id] ?? totals[String(goal.id)]) || 0,
        }));
    }

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const epochTimeToday = Math.floor(startOfDay.getTime() / 1000);
    const day = now.getDay();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((day + 6) % 7));
    lastMonday.setHours(0, 0, 0, 0);
    const epochTimeMonday = Math.floor(lastMonday.getTime() / 1000);
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    firstOfMonth.setHours(0, 0, 0, 0);
    const epochTimeMonth = Math.floor(firstOfMonth.getTime() / 1000);

    const list = pageResults(feed).filter((item) => item.workout__user === userId);
    const byPeriod = {
        day: list.filter((item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeToday),
        week: list.filter((item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeMonday),
        month: list.filter((item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeMonth),
    };

    return goals.map((goal) => {
        const filteredList = byPeriod[goal.period] || list;
        let points_capped = 0;
        for (const item of filteredList) {
            for (const detail of item.details || []) {
                if (detail.goal === goal.id) points_capped += Number(detail.points_capped) || 0;
            }
        }
        return {
            ...goal,
            goal: goal.goal * scale(goal),
            points_capped,
        };
    });
}

/** Count sports, drop step totals, keep the top N by frequency. */
export function topSportCounts(items, sportKey, {exclude = "Steps", limit = 4} = {}) {
    const counts = {};
    let total = 0;
    for (const item of items || []) {
        const sport = item?.[sportKey];
        if (!sport || sport === exclude) continue;
        total += 1;
        counts[sport] = (counts[sport] || 0) + 1;
    }
    const groups = Object.fromEntries(
        Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit),
    );
    return {total, groups};
}

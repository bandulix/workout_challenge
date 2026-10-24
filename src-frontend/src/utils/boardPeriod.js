/** Sum daily point totals for the last `days` offsets (0 = today). */
export function windowTotal(series, id, days, readDay) {
    let sum = 0;
    const span = Math.max(0, Number(days) || 0);
    for (let offset = 0; offset < span; offset += 1) {
        sum += Number(readDay(series, id, offset)) || 0;
    }
    return sum;
}

/** Rank a field by a score function. Ties share a rank; order is score, then username. */
export function rankPeople(people, scoreOf) {
    const rows = (people || []).map((person) => ({
        person,
        score: Number(scoreOf(person)) || 0,
    }));
    rows.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.person?.username || "").localeCompare(String(b.person?.username || ""));
    });
    let rank = 0;
    let last = null;
    return rows.map((row, index) => {
        if (last === null || row.score !== last) {
            rank = index + 1;
            last = row.score;
        }
        return {person: row.person, score: row.score, rank};
    });
}

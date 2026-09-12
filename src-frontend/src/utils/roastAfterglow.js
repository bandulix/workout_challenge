export const AFTERGLOW_MS = 60 * 60 * 1000;

export function roastIsAfterglow(card, now = Date.now()) {
    const at = Date.parse(card?.last_hot_at || "");
    return Boolean(at) && now >= at && now - at < AFTERGLOW_MS;
}

/** Unique hall leader (strictly most hots). Ties get no crown. */
export function roastHottestId(cards) {
    let best = 0;
    let id = null;
    let tied = false;
    for (const card of cards || []) {
        const n = Number(card?.hot_votes) || 0;
        if (n > best) {
            best = n;
            id = card.id;
            tied = false;
        } else if (n === best && n > 0 && card.id !== id) {
            tied = true;
        }
    }
    return best > 0 && !tied ? id : null;
}

export function hallAfterglowSfxItems(cards, now = Date.now()) {
    return (cards || [])
        .filter((c) => c?.id && roastIsAfterglow(c, now))
        // The swipe already stings; don't double-play for the voter.
        .filter((c) => !(c.my_vote === true && now - Date.parse(c.last_hot_at) < 8000))
        .map((c) => ({key: `roast-hot:${c.id}:${c.last_hot_at}`, sound: "roast_hot"}));
}

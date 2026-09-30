const ARCHIVE_KEY = "workout-challenge-archive-v1";

function browserStorage() {
    try {
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

function readIds(storage = browserStorage()) {
    if (!storage) return [];
    try {
        const parsed = JSON.parse(storage.getItem(ARCHIVE_KEY) || "[]");
        return Array.isArray(parsed)
            ? [...new Set(parsed.filter(id => typeof id === "string" && id.length > 0))]
            : [];
    } catch {
        return [];
    }
}

function writeIds(ids, storage = browserStorage()) {
    if (!storage) return;
    try {
        storage.setItem(ARCHIVE_KEY, JSON.stringify(ids));
    } catch {
        // Archiving is a local convenience; a storage quota/privacy block must not break Home.
    }
}

export function getArchivedChallengeIds() {
    return readIds();
}

export function archiveChallenge(id) {
    if (id === undefined || id === null || String(id).length === 0) return;
    const ids = readIds();
    const key = String(id);
    if (!ids.includes(key)) writeIds([...ids, key]);
}

export function restoreChallenge(id) {
    if (id === undefined || id === null) return;
    const key = String(id);
    writeIds(readIds().filter(existing => existing !== key));
}

export function isChallengeEnded(endDate, now = new Date()) {
    if (typeof endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
    const [year, month, day] = endDate.split("-").map(Number);
    const end = new Date(year, month - 1, day);
    if (end.getFullYear() !== year || end.getMonth() !== month - 1 || end.getDate() !== day) return false;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return end < today;
}

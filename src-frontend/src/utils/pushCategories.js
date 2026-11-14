/** Device-local push categories. Quiet hours stay on the server. */

const KEY = "wc-push-categories";
const DEFAULTS = {duels: true, coach: true, season: true, skiweek: true};

export function readPushCategories() {
    try {
        const raw = JSON.parse(window.localStorage.getItem(KEY) || "null");
        if (!raw || typeof raw !== "object") return {...DEFAULTS};
        return {
            duels: raw.duels !== false,
            coach: raw.coach !== false,
            season: raw.season !== false,
            skiweek: raw.skiweek !== false,
        };
    } catch {
        return {...DEFAULTS};
    }
}

export function writePushCategory(id, on) {
    const next = {...readPushCategories(), [id]: Boolean(on)};
    try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
        /* private mode */
    }
    announcePushCategories();
    return next;
}

export function pushCategoryOn(id) {
    return readPushCategories()[id] !== false;
}

export function announcePushCategories() {
    const categories = readPushCategories();
    const worker = navigator.serviceWorker;
    if (!worker?.ready) return;
    worker.ready.then((reg) => {
        reg.active?.postMessage({type: "wc-push-categories", categories});
    }).catch(() => {});
}

export function categoryForCoachKind(kind) {
    if (kind === "echo" || kind === "claim" || kind === "war") return "season";
    if (kind === "skiweek") return "skiweek";
    return "coach";
}

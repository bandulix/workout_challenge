// Tiny relative-time helpers for the coach feed ("just now", "2 h ago").

export function timeAgo(iso) {
    if (!iso) return "";
    const then = new Date(iso);
    const diff = Date.now() - then.getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d} d ago`;
    return then.toLocaleDateString(undefined, {day: "numeric", month: "short"});
}

export function dayLabel(iso) {
    const then = new Date(iso);
    const today = new Date();
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(today) - startOfDay(then)) / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    return then.toLocaleDateString(undefined, {weekday: "long", day: "numeric", month: "short"});
}

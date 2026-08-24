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

export function elapsedSince(iso, now = Date.now()) {
    if (!iso) return "";
    const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m ${String(sec % 60).padStart(2, "0")}s`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ${m % 60}m`;
    return timeAgo(iso);
}


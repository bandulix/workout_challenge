// Remember the last in-app screen so a cold start (APK always opens at
// "/") can skip the landing page and paint Coach/Home immediately.

const STORAGE_KEY = "wc_last_path";

function normalizePath(pathname) {
    const raw = pathname || "/";
    return raw.replace(/\/+$/, "") || "/";
}

export function isRestorablePath(pathname) {
    const p = normalizePath(pathname);
    // /admin/* is deliberately not restorable: a non-staff user (or a
    // lapsed session) would cold-start onto an "Admin only" dead end.
    return p === "/dashboard" || p === "/coach"
        || /^\/competition\/\d+$/.test(p);
}

export function rememberPath(pathname, search = "") {
    if (!isRestorablePath(pathname)) return;
    try {
        const qs = search && search !== "?" ? search : "";
        localStorage.setItem(STORAGE_KEY, normalizePath(pathname) + qs);
    } catch {
        /* quota / private mode */
    }
}

export function readLastPath() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return "/coach";
        const u = new URL(raw, window.location.origin);
        if (u.origin !== window.location.origin) return "/coach";
        if (!isRestorablePath(u.pathname)) return "/coach";
        return u.pathname + u.search;
    } catch {
        return "/coach";
    }
}

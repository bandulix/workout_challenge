// Auth screens (and the marketing landing) must not show the dock, fire
// `me` queries, or trigger the 401→/login reload loop. Trailing slashes
// are common (`navigate("/login/")`, nginx) and used to miss an exact match.

const PUBLIC_EXACT = new Set(["/", "/login", "/signup", "/logout", "/password"]);

export function normalizePath(pathname) {
    const raw = pathname || "/";
    return raw.replace(/\/+$/, "") || "/";
}

export function isPublicPath(pathname) {
    const p = normalizePath(pathname);
    if (PUBLIC_EXACT.has(p)) return true;
    if (p.startsWith("/password/")) return true;
    if (p.startsWith("/email/verify")) return true;
    return false;
}

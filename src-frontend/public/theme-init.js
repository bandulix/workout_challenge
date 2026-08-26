// Apply the stored theme before first paint (class-based dark mode).
// External file (not an inline <script>) so the Content-Security-Policy
// can forbid inline scripts entirely.
//
// No stored value (and "system") follow the device. color-scheme stays
// "light dark" in that case so prefers-color-scheme keeps tracking the OS
// instead of locking the page to light or dark.
(function () {
    try {
        // APK/PWA cold start is always "/". If a session exists, jump to
        // the last in-app screen BEFORE React mounts so the first paint
        // is Coach/Home (with rehydrated cache) instead of the landing
        // page plus a multi-second loader. Keep in sync with lastPath.js.
        var token = localStorage.getItem("refresh_token");
        if (token) {
            var here = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
            var params = new URLSearchParams(window.location.search || "");
            if (here === "/" && !params.get("join") && !params.get("action")) {
                var next = "/coach";
                try {
                    var last = localStorage.getItem("wc_last_path") || "/coach";
                    var u = new URL(last, window.location.origin);
                    var p = (u.pathname || "/").replace(/\/+$/, "") || "/";
                    var ok = u.origin === window.location.origin && (
                        p === "/dashboard" || p === "/coach" || p === "/admin/site-settings"
                        || /^\/competition\/\d+$/.test(p)
                    );
                    if (ok) next = p + u.search;
                } catch (e) { /* fall through to /coach */ }
                history.replaceState(null, "", next);
            }
        }

        var t = localStorage.getItem("wc-theme");
        if (t !== "light" && t !== "dark") t = "system";
        var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        var dark = t === "dark" || (t === "system" && systemDark);
        var root = document.documentElement;
        root.classList.toggle("dark", dark);
        root.classList.toggle("light", t === "light");
        root.style.colorScheme = t === "system" ? "light dark" : t;
        root.style.background = dark ? "#0b0b0c" : "#efece4";

        // Must match src/utils/dailyBackdrop.js (BACKDROP_IDS + FNV-1a).
        var ids = ["snowboard", "swim", "gravel", "studio", "lift"];
        var now = new Date();
        var key = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
        var h = 2166136261;
        for (var i = 0; i < key.length; i++) {
            h ^= key.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        var id = ids[(h >>> 0) % ids.length];
        var path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
        var cinematic = path === "/" || path === "/login" || path === "/signup"
            || path === "/logout" || path === "/password" || path.indexOf("/password/") === 0;
        var href = "/backdrops/" + id + ((cinematic || dark) ? "" : "-light") + ".webp";
        var link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.type = "image/webp";
        link.href = href;
        document.head.appendChild(link);
    } catch (e) { /* never block rendering */ }
})();

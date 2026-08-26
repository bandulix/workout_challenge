// Dark theme + last-path jump before first paint.
// External file (not an inline <script>) so the Content-Security-Policy
// can forbid inline scripts entirely.
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

        try { localStorage.removeItem("wc-theme"); } catch (e) { /* ignore */ }
        var root = document.documentElement;
        root.classList.add("dark");
        root.classList.remove("light");
        root.style.colorScheme = "dark";
        root.style.background = "#0b0b0c";

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
        var href = "/backdrops/" + id + ".webp";
        var link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.type = "image/webp";
        link.href = href;
        document.head.appendChild(link);
    } catch (e) { /* never block rendering */ }
})();

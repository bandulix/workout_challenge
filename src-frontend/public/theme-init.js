// Apply the stored theme before first paint (class-based dark mode).
// External file (not an inline <script>) so the Content-Security-Policy
// can forbid inline scripts entirely.
(function () {
    try {
        var t = localStorage.getItem("wc-theme") || "system";
        var dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = dark ? "dark" : "light";
        document.documentElement.style.background = dark ? "#0b0b0c" : "#d4deba";
    } catch (e) { /* never block rendering */ }
})();

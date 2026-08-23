import {useCallback, useEffect, useState} from "react";

// Class-based theme with three modes: light / dark / system (default).
// The inline boot script in public/index.html applies the class before
// first paint; this module is the React-side source of truth.

const STORAGE_KEY = "wc-theme";
const LIGHT_COLOR = "#dfe8c4";
const DARK_COLOR = "#0b0b0c";

export function getStoredTheme() {
    const t = window.localStorage.getItem(STORAGE_KEY);
    return t === "light" || t === "dark" ? t : "system";
}

function systemPrefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(theme = getStoredTheme()) {
    return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

export function applyTheme(theme = getStoredTheme()) {
    const resolved = resolveTheme(theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute("content", resolved === "dark" ? DARK_COLOR : LIGHT_COLOR);
    return resolved;
}

export function useTheme() {
    const [theme, setThemeState] = useState(getStoredTheme);
    const [resolved, setResolved] = useState(() => resolveTheme());

    useEffect(() => {
        setResolved(applyTheme(theme));
        if (theme !== "system") return undefined;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => setResolved(applyTheme("system"));
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [theme]);

    const setTheme = useCallback((next) => {
        window.localStorage.setItem(STORAGE_KEY, next);
        setThemeState(next);
    }, []);

    const toggle = useCallback(() => {
        setTheme(resolveTheme() === "dark" ? "light" : "dark");
    }, [setTheme]);

    return {theme, resolvedTheme: resolved, setTheme, toggle};
}

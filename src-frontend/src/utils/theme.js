import {useCallback, useEffect, useState} from "react";
import {Capacitor, SystemBars, SystemBarsStyle} from "@capacitor/core";

// Class-based theme with three modes: light / dark / system (default).
// The inline boot script in public/index.html applies the class before
// first paint; this module is the React-side source of truth.

const STORAGE_KEY = "wc-theme";
const LIGHT_COLOR = "#d4deba";
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

function syncNativeSystemBars(resolved) {
    if (!Capacitor.isNativePlatform()) return;
    SystemBars.setStyle({
        style: resolved === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => {});
}

export function applyTheme(theme = getStoredTheme()) {
    const resolved = resolveTheme(theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
    const color = resolved === "dark" ? DARK_COLOR : LIGHT_COLOR;
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute("content", color);
    document.documentElement.style.background = color;
    if (document.body) document.body.style.background = color;
    syncNativeSystemBars(resolved);
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

    const cycle = useCallback(() => {
        const order = ["system", "light", "dark"];
        const i = order.indexOf(theme);
        setTheme(order[(i < 0 ? 0 : i + 1) % order.length]);
    }, [theme, setTheme]);

    const toggle = useCallback(() => {
        cycle();
    }, [cycle]);

    return {theme, resolvedTheme: resolved, setTheme, toggle, cycle};
}

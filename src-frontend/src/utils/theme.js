import {useEffect} from "react";
import {Capacitor, SystemBars, SystemBarsStyle} from "@capacitor/core";

// Dark is the default. A stored "light" choice is the only way out of it.
// Boot class is applied in public/theme-init.js before first paint.

const DARK_COLOR = "#0b0b0c";
const LIGHT_COLOR = "#f3f3f4";
const STORAGE_KEY = "wc-theme";

export function readTheme() {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
    } catch {
        return "dark";
    }
}

export function applyTheme(mode) {
    const light = mode === "light";
    const root = document.documentElement;
    root.classList.toggle("dark", !light);
    root.classList.toggle("light", light);
    const color = light ? LIGHT_COLOR : DARK_COLOR;
    root.style.colorScheme = light ? "light" : "dark";
    root.style.background = color;
    if (document.body) document.body.style.background = color;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", color);
    try {
        window.localStorage.setItem(STORAGE_KEY, light ? "light" : "dark");
    } catch {
        /* ignore quota / private mode */
    }
    if (Capacitor.isNativePlatform()) {
        const style = light ? SystemBarsStyle.Light : SystemBarsStyle.Dark;
        SystemBars.setStyle({style}).catch(() => {});
    }
}

export function applyDark() {
    applyTheme("dark");
}

export function useDarkTheme() {
    useEffect(() => {
        applyTheme(readTheme());
    }, []);
}

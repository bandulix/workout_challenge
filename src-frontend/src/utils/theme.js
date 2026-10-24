import {useEffect} from "react";
import {Capacitor, SystemBars, SystemBarsStyle} from "@capacitor/core";

// Dark is the only theme. Boot class is applied in public/theme-init.js
// before first paint; this module keeps native system bars in sync.

const DARK_COLOR = "#0b0b0c";
const STORAGE_KEY = "wc-theme";

export function applyDark() {
    const root = document.documentElement;
    root.classList.add("dark");
    root.classList.remove("light");
    root.style.colorScheme = "dark";
    root.style.background = DARK_COLOR;
    if (document.body) document.body.style.background = DARK_COLOR;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", DARK_COLOR);
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore quota / private mode */
    }
    if (Capacitor.isNativePlatform()) {
        SystemBars.setStyle({style: SystemBarsStyle.Dark}).catch(() => {});
    }
}

export function useDarkTheme() {
    useEffect(() => {
        applyDark();
    }, []);
}

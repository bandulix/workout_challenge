import {isNativeApp} from "./platform";

// Foreground / resume signals.
//
// Chrome and the PWA get a reliable `visibilitychange`. The Android
// WebView often does not: Capacitor parks the renderer, polling stops,
// and coming back never fires the DOM event — so the UI keeps serving
// the last RTK snapshot until the user navigates. Native apps (and
// Capacitor's own docs) listen to the App plugin instead.

export function subscribeForeground(onChange) {
    let cancelled = false;
    let handle = null;

    if (isNativeApp()) {
        import("@capacitor/app").then(({App}) => {
            if (cancelled) return;
            App.addListener("appStateChange", ({isActive}) => {
                if (!cancelled) onChange(Boolean(isActive));
            }).then((h) => {
                if (cancelled) h.remove();
                else handle = h;
            });
        }).catch(() => { /* plugin missing in a web preview */ });
        return () => {
            cancelled = true;
            handle?.remove();
        };
    }

    const fromDocument = () => onChange(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", fromDocument);
    return () => document.removeEventListener("visibilitychange", fromDocument);
}

export function onAppResume(callback) {
    return subscribeForeground((active) => {
        if (active) callback();
    });
}

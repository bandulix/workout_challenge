/** Non-blocking snackbar for success/info/error feedback. The
 * ToastHost in App.js listens for these events and renders them above
 * the dock. Use `notice()` (dialogs.js) only when the user must
 * acknowledge the message before continuing. */

export function toast(message, {kind = "info", duration} = {}) {
    const text = String(message ?? "").trim();
    if (!text) return;
    window.dispatchEvent(new CustomEvent("wc-toast", {
        detail: {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            message: text,
            kind,
            duration: duration ?? (kind === "error" ? 6500 : 4500),
        },
    }));
}

toast.success = (message, options = {}) => toast(message, {...options, kind: "success"});
toast.error = (message, options = {}) => toast(message, {...options, kind: "error"});

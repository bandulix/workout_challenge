/** Promise-based confirm/alert that the DialogHost in App.js answers. */

export function confirmAction(message) {
    return new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent("wc-dialog", {detail: {kind: "confirm", message, resolve}}));
    });
}

export function notice(message) {
    return new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent("wc-dialog", {detail: {kind: "notice", message, resolve}}));
    });
}

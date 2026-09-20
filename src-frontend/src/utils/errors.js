/** Human-readable message for an RTK Query / fetch error.
 *
 * Never leak raw `JSON.stringify(err)`, HTTP status soup
 * ("Update Error (500 undefined): ...") or HTML error pages into the
 * UI - map them to a sentence the user can act on. */

const DEFAULT_MESSAGE = "Something went wrong. Please try again.";

function looksLikeHtml(text) {
    return /^\s*<!doctype|^\s*<html|^\s*<head|^\s*<body/i.test(text);
}

export function errText(err, fallback = DEFAULT_MESSAGE) {
    if (!err) return fallback;

    // fetchBaseQuery shapes: {status: 'FETCH_ERROR'|'TIMEOUT_ERROR'|...}
    if (err.status === "FETCH_ERROR") return "No connection to the server. Check your network and try again.";
    if (err.status === "TIMEOUT_ERROR") return "The server is not answering. Try again in a moment.";
    if (err.status === 429) return "Too many attempts. Give it a minute and try again.";

    const data = err.data;
    if (typeof data === "string") {
        const clean = data.trim();
        // Server 500 pages arrive as a wall of HTML - never show that.
        if (clean && !looksLikeHtml(clean) && clean.length <= 300) return clean;
        return fallback;
    }
    if (data && typeof data === "object") {
        if (typeof data.detail === "string" && data.detail.trim()) return data.detail.trim();
        if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
        // DRF field errors: {field: ["msg", ...], ...} - surface the
        // first one; field-level display is the form's own job.
        for (const value of Object.values(data)) {
            if (Array.isArray(value) && value.length > 0) return value.join(" ");
            if (typeof value === "string" && value.trim()) return value.trim();
        }
    }
    return fallback;
}

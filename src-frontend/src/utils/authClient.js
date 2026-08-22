import store from "./store";
import {usersApi} from "./reducers/usersSlice";
import {sentryError} from "./reducers/baseQueryWithReauth";

function firstErrorMessage(parsedError) {
    if (!parsedError) return null;
    if (typeof parsedError.detail === "string") return parsedError.detail;
    if (Array.isArray(parsedError.non_field_errors) && parsedError.non_field_errors.length) {
        return parsedError.non_field_errors.join(" ");
    }
    for (const value of Object.values(parsedError)) {
        if (Array.isArray(value) && value.length) return value.join(" ");
        if (typeof value === "string") return value;
    }
    return null;
}

function rtkErrorMessage(result, fallback) {
    const status = result.error?.status || result.error?.originalStatus || "";
    const data = result.error?.data;
    const detail = firstErrorMessage(data) || result.error?.error || "Unknown error";
    return `${result.error?.statusText || "Error"} (${status}) - ${detail || fallback}`;
}

async function dispatchEndpoint(endpoint, body, sentryName) {
    try {
        const result = await store.dispatch(usersApi.endpoints[endpoint].initiate(body));
        if (result.data !== undefined && !result.error) {
            return [true, result.data];
        }
        return [false, rtkErrorMessage(result, "Unknown error")];
    } catch (error) {
        sentryError({result: error, errorSource: "manual-api", endpointName: sentryName});
        return [false, "Network or server error occurred. Please try again."];
    }
}

export async function apiCreateAccount(email, first_name, last_name, gender, password, invite_token, join_code) {
    const [ok, data] = await dispatchEndpoint("register", {
        email: email.toLowerCase(),
        first_name,
        last_name,
        gender,
        password,
        invite_token,
        join_code: join_code || "",
    }, "register");
    if (!ok) return [false, "Registration Error: " + data];
    return [true, undefined];
}

export async function apiLogin(email, password) {
    const [ok, data] = await dispatchEndpoint("login", {
        email: email.toLowerCase(),
        password,
    }, "login");
    if (!ok) return [false, data];
    localStorage.setItem("access_token", data.access);
    localStorage.setItem("refresh_token", data.refresh);
    return [true, undefined];
}

export async function apiRequestNewPassword(email) {
    const [ok, data] = await dispatchEndpoint("passwordResetRequest", {email}, "new-password-request");
    if (!ok) return [false, data];
    return [true, undefined];
}

export async function apiSetNewPassword(uid, token, newPassword) {
    const [ok, data] = await dispatchEndpoint("passwordResetConfirm", {
        uid, token, new_password: newPassword,
    }, "set-new-password");
    if (!ok) return [false, data];
    return [true, undefined];
}

export async function apiRefreshToken(refreshToken) {
    try {
        const result = await store.dispatch(usersApi.endpoints.refreshToken.initiate({refresh: refreshToken}));
        if (result.data?.access) {
            localStorage.setItem("access_token", result.data.access);
            if (result.data.refresh) {
                localStorage.setItem("refresh_token", result.data.refresh);
            }
            return [true, undefined];
        }
        const status = result.error?.status;
        if (status === 400 || status === 401) {
            // Only drop the stored refresh if it is still the one we
            // sent - a login that finished while this refresh was in
            // flight owns the current key.
            if (localStorage.getItem("refresh_token") === refreshToken) {
                localStorage.removeItem("refresh_token");
            }
        }
        return [false, rtkErrorMessage(result, "Unknown error")];
    } catch (error) {
        sentryError({result: error, errorSource: "manual-api", endpointName: "refresh-token"});
        return [false, "Network or server error occurred during token refresh. Please try again."];
    }
}

export function sanitizeRedirect(value) {
    if (!value) return null;
    let raw;
    try {
        raw = decodeURIComponent(value);
    } catch (e) {
        return null;
    }
    if (!raw || typeof raw !== "string") return null;
    if (!raw.startsWith("/")) return null;
    if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
    if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
    return raw;
}

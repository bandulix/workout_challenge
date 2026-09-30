import store from "./store";
import {usersApi} from "./reducers/usersSlice";
import {sentryError} from "./reducers/baseQueryWithReauth";
import {errText} from "./errors";
import {
  applyAuthResponse,
  clearAuthSession,
  ensureFreshAccessToken,
  getAccessToken,
} from "./authTokens";

async function dispatchEndpoint(endpoint, body, sentryName) {
  try {
    const result = await store.dispatch(usersApi.endpoints[endpoint].initiate(body));
    if (result.data !== undefined && !result.error) {
      return [true, result.data];
    }
    // errText maps the DRF / fetchBaseQuery error shapes to one sentence
    // (no "Error (401) - ..." status soup on the login form).
    return [false, errText(result.error, "Unknown error")];
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
  // Access in memory; refresh via Set-Cookie (web) / secure store (native).
  // Never write JWTs to localStorage.
  await applyAuthResponse(data);
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

export async function apiConfirmEmail(uid, token) {
  const [ok, data] = await dispatchEndpoint("emailVerifyConfirm", {
    uid, token,
  }, "email-verify-confirm");
  if (!ok) return [false, data];
  return [true, undefined];
}

export async function apiRefreshToken() {
  // The refresh token lives in the httpOnly cookie (web) or the secure
  // store (native); callers never hand it over.
  try {
    const status = await ensureFreshAccessToken();
    if (status === "ok" && getAccessToken()) return [true, undefined];
    if (status === "dead") {
      await clearAuthSession();
    }
    return [false, "Token refresh failed"];
  } catch (error) {
    sentryError({result: error, errorSource: "manual-api", endpointName: "refresh-token"});
    return [false, "Network or server error occurred during token refresh. Please try again."];
  }
}

export function sanitizeRedirect(value) {
  if (!value) return null;
  // The value comes from URLSearchParams.get(), which has already decoded
  // it once - decoding again would throw on a legit path containing "%".
  const raw = value;
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
  return raw;
}

import {getServerUrl, isNativeApp} from "./serverUrl";
import {
  cacheNativeRefresh,
  clearSecureRefresh,
  getSecureRefresh,
  peekNativeRefresh,
  setSecureRefresh,
} from "./secureRefreshStore";

// Shared session helpers. CrowdSec/fail2ban HTTP brute-force scenarios
// trip on bursts of 401s - which this app used to produce every time the
// access token expired. Refreshing *before* expiry (and sharing one
// in-flight POST /token/refresh/) keeps those 401s off the wire.
//
// Issue #19 (BREAKING): access JWT is memory-only. Refresh is an
// httpOnly Secure cookie on web/PWA (credentials:include), and Capacitor
// Secure Storage on Android. localStorage is never used for JWTs
// (stale keys cleared once on load).

const REFRESH_SKEW_MS = 60 * 1000;
const AUTH_MARKER = "wc_auth";

let accessTokenMemory = null;
let refreshPromise = null;
let clearedStale = false;

/** One-time cleanup of pre-#19 localStorage JWT keys. */
export function clearStaleLocalStorageTokens() {
  if (clearedStale) return;
  clearedStale = true;
  try {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  } catch {
    /* private mode */
  }
}

clearStaleLocalStorageTokens();

export function getAccessToken() {
  clearStaleLocalStorageTokens();
  return accessTokenMemory;
}

export function setAccessToken(token) {
  accessTokenMemory = token || null;
  if (token) markLoggedIn();
}

export function clearAccessToken() {
  accessTokenMemory = null;
}

export function markLoggedIn() {
  try {
    sessionStorage.setItem(AUTH_MARKER, "1");
  } catch {
    /* ignore */
  }
}

export function markLoggedOut() {
  accessTokenMemory = null;
  try {
    sessionStorage.removeItem(AUTH_MARKER);
  } catch {
    /* ignore */
  }
}

/** Non-secret session hint for cold-start gates (cookie is httpOnly). */
export function hasAuthMarker() {
  try {
    return sessionStorage.getItem(AUTH_MARKER) === "1";
  } catch {
    return false;
  }
}

/** @deprecated Prefer hasAuthMarker / cookie refresh. Always null on web. */
export function getRefreshToken() {
  if (isNativeApp()) return peekNativeRefresh();
  return null;
}

export function accessTokenExpiresAt(token) {
  if (!token || typeof token !== "string") return 0;
  const parts = token.split(".");
  if (parts.length < 2) return 0;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64 + pad));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function accessTokenNeedsRefresh(token = getAccessToken()) {
  const exp = accessTokenExpiresAt(token);
  if (!token || !exp) return true;
  return exp - Date.now() <= REFRESH_SKEW_MS;
}

function fetchWithTimeout(url, options, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, {...options, signal: ctrl.signal}).finally(() => clearTimeout(timer));
}

function clientHeaders(extra = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Requested-With": "WorkoutChallenge",
    ...extra,
  };
  if (isNativeApp()) {
    headers["X-WC-Client"] = "native";
    headers["User-Agent"] = "WorkoutChallenge/1.0 (Android)";
  }
  return headers;
}

/**
 * Apply tokens from a login/refresh JSON response.
 * Web: ignore refresh in body (cookie is source of truth).
 * Native: persist refresh into secure storage when present.
 */
export async function applyAuthResponse(data) {
  if (data?.access) {
    setAccessToken(data.access);
    markLoggedIn();
  }
  if (isNativeApp() && data?.refresh) {
    await setSecureRefresh(data.refresh);
    cacheNativeRefresh(data.refresh);
  }
}

export async function clearAuthSession() {
  clearAccessToken();
  markLoggedOut();
  await clearSecureRefresh();
  clearStaleLocalStorageTokens();
}

export function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    clearStaleLocalStorageTokens();
    const nativeRefresh = isNativeApp()
      ? (peekNativeRefresh() || (await getSecureRefresh()))
      : null;
    if (isNativeApp() && !nativeRefresh && !hasAuthMarker() && !getAccessToken()) {
      return "none";
    }
    try {
      const body = nativeRefresh ? {refresh: nativeRefresh} : {};
      const res = await fetchWithTimeout(`${getServerUrl()}/api/token/refresh/`, {
        method: "POST",
        headers: clientHeaders(),
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.access) {
          await applyAuthResponse(data);
          return "ok";
        }
      }
      if (res.status === 400 || res.status === 401) {
        await clearAuthSession();
        return "dead";
      }
      return "fail";
    } catch {
      return "fail";
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function ensureFreshAccessToken() {
  clearStaleLocalStorageTokens();
  if (!accessTokenNeedsRefresh()) return "ok";
  if (isNativeApp()) {
    const refresh = peekNativeRefresh() || (await getSecureRefresh());
    if (!refresh && !getAccessToken() && !hasAuthMarker()) return "none";
  }
  return refreshAccessToken();
}

/** Server logout: blacklist refresh + clear cookie. Best-effort. */
export async function apiLogoutRefresh() {
  const nativeRefresh = isNativeApp()
    ? (peekNativeRefresh() || (await getSecureRefresh()))
    : null;
  try {
    await fetchWithTimeout(`${getServerUrl()}/api/token/logout/`, {
      method: "POST",
      headers: clientHeaders(),
      body: JSON.stringify(nativeRefresh ? {refresh: nativeRefresh} : {}),
      cache: "no-store",
      credentials: "include",
    });
  } catch {
    /* still clear local state */
  }
  await clearAuthSession();
}

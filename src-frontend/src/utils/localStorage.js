// Keys that must never be persisted to localStorage (XSS-exfiltrable
// on shared devices). The JWT access / refresh tokens live in their
// own keys, but if the auth slice were ever to hold them we'd strip
// them here as well.
const NEVER_PERSIST = new Set([
  "access_token",
  "refresh_token",
  "password",
  "current_password",
  "new_password",
  "llm_api_key",
  "strava_client_secret",
  "email_host_password",
  "matrix_access_token",
  "p256dh",
  "auth",
]);


function _scrub(value) {
  if (Array.isArray(value)) return value.map(_scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = NEVER_PERSIST.has(k) ? undefined : _scrub(v);
    }
    return out;
  }
  return value;
}


export const loadState = () => {
  try {
    const serialized = localStorage.getItem('appState');
    return serialized ? JSON.parse(serialized) : undefined;
  } catch {
    return undefined;
  }
};

export const saveState = (state) => {
  try {
    const serialized = JSON.stringify(_scrub(state));
    localStorage.setItem('appState', serialized);
  } catch {
    // Ignore write errors
  }
};
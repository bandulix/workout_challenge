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
  "health_developer_password",
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


// Bump when persisted API query shapes change so old blobs are dropped
// instead of rehydrating incompatible cache entries.
export const PERSIST_VERSION = 1;

export const loadState = () => {
  try {
    const serialized = localStorage.getItem('appState');
    if (!serialized) return undefined;
    const parsed = JSON.parse(serialized);
    if (parsed && parsed._v === PERSIST_VERSION && parsed.state) {
      return parsed.state;
    }
    // Legacy unversioned blob: it used to include fossilized RTK caches.
    // Keep only non-API keys (there are none today) rather than replay them.
    if (parsed && !parsed._v) {
      return Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.endsWith('Api')));
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export const saveState = (state) => {
  try {
    const serialized = JSON.stringify({_v: PERSIST_VERSION, state: _scrub(state)});
    localStorage.setItem('appState', serialized);
    return true;
  } catch {
    return false;
  }
};
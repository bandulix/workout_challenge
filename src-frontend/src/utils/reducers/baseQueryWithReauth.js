import {fetchBaseQuery} from '@reduxjs/toolkit/query/react';
import {throwErrorWithCode} from '../miscellaneous';
import {getServerUrl} from '../serverUrl';
import {ensureFreshAccessToken, refreshAccessToken} from '../authTokens';
import {isPublicPath} from '../publicPath';

// Sentry is loaded on demand (dynamic import) so the SDK stays out of
// the initial bundle when no DSN is configured.
function getSentry() {
    return import('@sentry/react').catch(() => null);
}

if (process.env.NODE_ENV !== 'production') {
    console.log('API URL:', process.env.REACT_APP_BACKEND_URL);
}

// Module-level cache so Sentry's per-error Resource Timing lookup
// doesn't repeat the O(n) getEntriesByType scan on every 4xx/5xx.
const requestTimings = new Map();

const baseQuery = fetchBaseQuery({
    baseUrl: getServerUrl() + '/api/',
    // Never serve from the WebView's HTTP cache: its disk cache survives
    // app restarts and otherwise decides staleness heuristically (the
    // backend now also sends no-store - this is the client-side half).
    cache: 'no-store',
    // A stalled mobile connection must not pin a query in "pending"
    // forever (RTK serves the stale cached data while it hangs) - fail
    // after 30s so the UI can error/refresh instead of lying by
    // omission. Generous on purpose: the Garmin SSO roundtrip and cold
    // LLM-adjacent endpoints can be slow.
    timeout: 30000,
    prepareHeaders: (headers) => {
        const token = localStorage.getItem('access_token');
        // Endpoints sending FormData (file uploads) mark themselves with
        // X-Skip-Content-Type so the browser can set the multipart boundary.
        if (headers.get('X-Skip-Content-Type')) {
            headers.delete('X-Skip-Content-Type');
        } else {
            headers.set('Content-Type', 'application/json');
        }
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        return headers;
    },
});


// Fields whose values must never leave the browser via Sentry.
const REDACTED_FIELDS = new Set([
    'password', 'current_password', 'new_password',
    'llm_api_key', 'strava_client_secret', 'email_host_password',
    'health_developer_password',
    'token', 'access_token', 'refresh_token',
    'p256dh', 'auth',  // push subscription secrets
]);


function _redact(value) {
    if (Array.isArray(value)) return value.map(_redact);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = REDACTED_FIELDS.has(k) ? '[REDACTED]' : _redact(v);
        }
        return out;
    }
    return value;
}


export function sentryError({result, errorSource, endpointName = undefined, queryArgs = undefined}) {
    // Fire-and-forget: if the SDK can't load (offline, no DSN), drop
    // the report rather than break the caller.
    getSentry().then((Sentry) => {
        if (!Sentry) return;
        Sentry.withScope((scope) => {
        // Add request query args (with sensitive fields redacted).
        scope.setContext('Request', _redact({
            ...queryArgs,
            endpointName,
        }));

        // Add error message
        scope.setContext('Error', {
            ...result.error,
            error: result.error?.error,
        });

        // Add API request specific performance data
        const requestUrl = getServerUrl() + '/api/' + (queryArgs?.args?.url || '');
        // Walk performance entries once - .getEntriesByType is O(n) per
        // call so caching on a module-level Map keeps the hot path fast.
        if (!requestTimings.has(requestUrl)) {
            const entry = performance.getEntriesByType('resource')
                .filter((e) => e.name.includes(requestUrl))
                .pop();
            if (entry) requestTimings.set(requestUrl, entry);
        }
        const resourceTimings = requestTimings.get(requestUrl);
        if (resourceTimings) {
            scope.setContext('Request Timing', {
                duration: resourceTimings.duration,
                fetchStart: resourceTimings.fetchStart,
                responseEnd: resourceTimings.responseEnd,
                requestStart: resourceTimings.requestStart,
                responseStart: resourceTimings.responseStart,
                dnsTime: resourceTimings.domainLookupEnd - resourceTimings.domainLookupStart,
                tcpTime: resourceTimings.connectEnd - resourceTimings.connectStart,
            });
        }

        // Add additional properties
        scope.setTag('network.online', navigator?.onLine);
        scope.setTag('network.connection', navigator?.connection?.effectiveType);
        scope.setTag('error.source', errorSource);
        scope.setTag('error.status', result.error?.originalStatus || result.error?.status);
        if ((result.error?.originalStatus || result.error?.status) >= 500) {
            scope.setTag('error.type', 'server');
        } else if ((result.error?.originalStatus || result.error?.status) >= 400) {
            scope.setTag('error.type', 'client');
        }

        // Raise error
        Sentry.captureException(
            new Error(`API Request failed: ${result.error?.originalStatus || result.error?.status}`)
        );
        });
    });
}


function redirectToLogin() {
    const safeRedirect = window.location.pathname + window.location.search;
    window.location.href = `/login?redirect=${encodeURIComponent(safeRedirect)}`;
}

function onPublicPath() {
    return isPublicPath(window.location.pathname);
}


export const baseQueryWithReauth = async (args, api, extraOptions) => {
    // Refresh *before* the request when the access token is expired or
    // about to be, so polling slices never stampede the API with 401s
    // (CrowdSec http-generic-bf / http-auth-bf).
    if (!extraOptions?.skipReauth && !onPublicPath()) {
        const pre = await ensureFreshAccessToken();
        if (pre === 'dead' && !onPublicPath()) {
            redirectToLogin();
            throw throwErrorWithCode('(Error 401) The user is not authenticated (refresh token expired). Please re-login.', 401);
        }
    }

    let result = await baseQuery(args, api, extraOptions);

    // Login / register / refresh / password-reset must not enter the
    // 401→refresh loop (a 401 on /token/ is "wrong password").
    if (extraOptions?.skipReauth) {
        return result;
    }

    // report to Sentry if not 401 (login access token needs refreshing) and 403 (forbidden - strava access rights insufficient) and 429 (too many strava sync requests) and 404 (not found after entry deletion)
    if (result.error && result.error.status !== 401 && result.error.status !== 403 && result.error.status !== 429 && result.error.status !== 404) {
        sentryError({
            result: result,
            errorSource: 'rtk-query',
            endpointName: api?.endpoint,
            queryArgs: {args, extraOptions},
        });
    }

    // If 401 forbidden error refresh the access token.
    //
    // Bail out early if we're already on a public page (login /
    // signup / password reset / etc). The BottomNav fires
    // `useGetUserByIdQuery('me')` on every page, so without this
    // guard a stale / missing token causes baseQueryWithReauth to
    // reload the browser to `/login?redirect=<current URL>`. On the
    // next page load the same API call returns 401 again, the redirect
    // is recomputed against the new (already-nested) URL, and the
    // redirect param grows by one layer of percent-encoding on every
    // iteration - an infinite reload loop that bricks the browser.
    if (result.error && result.error.status === 401) {
        // '/logout' included: the bottom nav's 'me' query is still
        // subscribed while LogoutPage wipes the tokens - without this
        // guard its 401 redirected to /login?redirect=/logout, and the
        // next login navigated straight back to /logout (wiping the
        // just-issued tokens - a login-logout loop).
        if (onPublicPath()) {
            // Already on the login flow - just propagate the 401 so
            // the calling component can show its error UI.
            return result;
        }

        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) {
            redirectToLogin();
            throw throwErrorWithCode('(Error 401) The user is not authenticated (no refresh token). Please re-login.', 401);
        }

        // Shared in-flight POST /token/refresh/ (also used by avatar
        // fetches and native coach pings) - one refresh, not one per
        // polling slice.
        const refreshStatus = await refreshAccessToken();

        if (refreshStatus === 'ok') {
            result = await baseQuery(args, api, extraOptions);
        } else if (refreshStatus === 'dead') {
            redirectToLogin();
            throw throwErrorWithCode('(Error 401) The user is not authenticated (refresh token expired). Please re-login.', 401);
        }
        // 'fail' (429/5xx/network): keep tokens, surface the original 401
        // so the UI shows stale data while the next poll retries.
    }

    return result;
};
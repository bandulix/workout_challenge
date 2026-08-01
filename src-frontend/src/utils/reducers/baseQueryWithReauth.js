import {fetchBaseQuery} from '@reduxjs/toolkit/query/react';
import {throwErrorWithCode} from '../miscellaneous';

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
    baseUrl: (process.env.REACT_APP_BACKEND_URL || '') + '/api/',
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
        const requestUrl = (process.env.REACT_APP_BACKEND_URL || '') + '/api/' + (queryArgs?.args?.url || '');
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


// Deduplicate concurrent token refreshes: when a session expires, every
// polling slice (feed/stats/drill/competitions/user) gets a 401 at roughly
// the same time. Without a shared in-flight refresh, each fires its own
// POST /token/refresh/ - a burst of ~10 auth 401s in seconds, which is
// exactly what fail2ban/CrowdSec http-auth-bruteforce scenarios ban for.
let refreshPromise = null;

function refreshTokens(api, extraOptions, refreshToken) {
    if (!refreshPromise) {
        refreshPromise = (async () => {
            const refreshResult = await baseQuery(
                {
                    url: '/token/refresh/',
                    method: 'POST',
                    body: {refresh: refreshToken},
                },
                api,
                extraOptions
            );
            if (refreshResult.data?.access) {
                // Save new tokens
                localStorage.setItem('access_token', refreshResult.data.access);
                if (refreshResult.data.refresh) {
                    localStorage.setItem('refresh_token', refreshResult.data.refresh);
                }
            }
            return refreshResult;
        })().finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}


export const baseQueryWithReauth = async (args, api, extraOptions) => {
    let result = await baseQuery(args, api, extraOptions);

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
        const PUBLIC_PATHS = ['/login', '/signup', '/password'];
        if (PUBLIC_PATHS.some((p) => window.location.pathname === p || window.location.pathname.startsWith(p + '/'))) {
            // Already on the login flow - just propagate the 401 so
            // the calling component can show its error UI.
            return result;
        }

        const refreshToken = localStorage.getItem('refresh_token');
        // Only embed path + search (not hash, not an attacker-controlled
        // query string). encodeURIComponent keeps the value URL-safe.
        const safeRedirect = window.location.pathname + window.location.search;
        const currentUrl = encodeURIComponent(safeRedirect);
        if (!refreshToken) {
            window.location.href = `/login?redirect=${currentUrl}`; // force redirect
            throw throwErrorWithCode('(Error 401) The user is not authenticated (no refresh token). Please re-login.', 401);
        }

        // Try to refresh the token (shared in-flight promise - see above)
        const refreshResult = await refreshTokens(api, extraOptions, refreshToken);

        if (refreshResult.data?.access) {
            // Retry original request
            result = await baseQuery(args, api, extraOptions);
        } else {
            window.location.href = `/login?redirect=${currentUrl}`; // force redirect
            throw throwErrorWithCode('(Error 401) The user is not authenticated (refresh token expired). Please re-login.', 401);
        }
    }

    return result;
};
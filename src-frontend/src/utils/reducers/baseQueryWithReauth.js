import {fetchBaseQuery, retry} from '@reduxjs/toolkit/query/react';
import {throwErrorWithCode} from '../miscellaneous';
import {getServerUrl} from '../serverUrl';
import {ensureFreshAccessToken, getAccessToken, refreshAccessToken} from '../authTokens';
import {isPublicPath} from '../publicPath';
import {isNativeApp} from '../platform';

// Gate on the runtime DSN: without it the first API hiccup would still
// download the (heavy) Sentry chunk for nothing. (typeof guard: the unit
// tests run in node, where no window exists.)
const SENTRY_ENABLED = typeof window !== "undefined"
    && Boolean(window.RUNTIME_CONFIG?.REACT_APP_SENTRY_DSN);

function getSentry() {
    if (!SENTRY_ENABLED) return Promise.resolve(null);
    return import('@sentry/react').catch(() => null);
}

if (process.env.NODE_ENV !== 'production') {
    console.log('API URL:', process.env.REACT_APP_BACKEND_URL);
}

const requestTimings = new Map();

const rawBaseQuery = fetchBaseQuery({
    baseUrl: getServerUrl() + '/api/',
    cache: 'no-store',
    // Send httpOnly refresh cookie on same-origin / credentialed calls.
    credentials: 'include',
    timeout: 30000,
    prepareHeaders: (headers) => {
        const token = getAccessToken();
        if (headers.get('X-Skip-Content-Type')) {
            headers.delete('X-Skip-Content-Type');
        } else {
            headers.set('Content-Type', 'application/json');
        }
        headers.set('X-Requested-With', 'WorkoutChallenge');
        if (isNativeApp()) {
            headers.set('X-WC-Client', 'native');
        }
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        return headers;
    },
});

// One transparent retry on transient failures (mobile lie-fi blips used
// to bounce users straight into a full-page error box). Retry only GETs
// (idempotent); RTK's default already skips 4xx-ish client errors.
const baseQuery = retry(rawBaseQuery, {
    maxRetries: 1,
    retryCondition: (error, args, {attempt}) =>
        attempt === 1 && (args?.method || 'GET') === 'GET'
        && ['FETCH_ERROR', 'TIMEOUT_ERROR'].includes(error?.status),
});

// PII and credentials must never reach the error tracker: a failed
// register/login POST otherwise ships the user's email/name and the
// shared invite token to a third party.
const REDACTED_FIELDS = new Set([
    'password', 'current_password', 'new_password',
    'llm_api_key', 'strava_client_secret', 'email_host_password',
    'health_developer_password',
    'token', 'access_token', 'refresh_token',
    'p256dh', 'auth',
    'email', 'first_name', 'last_name', 'invite_token', 'join_code',
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
    getSentry().then((Sentry) => {
        if (!Sentry) return;
        Sentry.withScope((scope) => {
        scope.setContext('Request', _redact({
            ...queryArgs,
            endpointName,
        }));

        scope.setContext('Error', {
            ...result.error,
            error: result.error?.error,
        });

        const requestUrl = getServerUrl() + '/api/' + (queryArgs?.args?.url || '');
        if (!requestTimings.has(requestUrl)) {
            const entry = performance.getEntriesByType('resource')
                .filter((e) => e.name.includes(requestUrl))
                .pop();
            if (entry) requestTimings.set(requestUrl, entry);
        }
        // Read-then-delete: this map is a per-URL memo, not an archive -
        // leaving entries in it grows memory for the whole session.
        const resourceTimings = requestTimings.get(requestUrl);
        requestTimings.delete(requestUrl);
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

        scope.setTag('network.online', navigator?.onLine);
        scope.setTag('network.connection', navigator?.connection?.effectiveType);
        scope.setTag('error.source', errorSource);
        scope.setTag('error.status', result.error?.originalStatus || result.error?.status);
        if ((result.error?.originalStatus || result.error?.status) >= 500) {
            scope.setTag('error.type', 'server');
        } else if ((result.error?.originalStatus || result.error?.status) >= 400) {
            scope.setTag('error.type', 'client');
        }

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
    if (!extraOptions?.skipReauth && !onPublicPath()) {
        const pre = await ensureFreshAccessToken();
        if (pre === 'dead' && !onPublicPath()) {
            redirectToLogin();
            throw throwErrorWithCode('(Error 401) The user is not authenticated (refresh token expired). Please re-login.', 401);
        }
    }

    let result = await baseQuery(args, api, extraOptions);

    if (extraOptions?.skipReauth) {
        return result;
    }

    if (result.error && result.error.status !== 401 && result.error.status !== 403 && result.error.status !== 429 && result.error.status !== 404) {
        sentryError({
            result: result,
            errorSource: 'rtk-query',
            endpointName: api?.endpoint,
            queryArgs: {args, extraOptions},
        });
    }

    if (result.error && result.error.status === 401) {
        if (onPublicPath()) {
            return result;
        }

        // Web: the httpOnly cookie may still be present even without a
        // marker; native: secure store / marker. Always attempt one shared
        // refresh - even when both look empty (the cookie is invisible).
        const refreshStatus = await refreshAccessToken();

        if (refreshStatus === 'ok') {
            result = await baseQuery(args, api, extraOptions);
        } else if (refreshStatus === 'dead' || refreshStatus === 'none') {
            redirectToLogin();
            throw throwErrorWithCode('(Error 401) The user is not authenticated (refresh token expired). Please re-login.', 401);
        }
    }

    return result;
};

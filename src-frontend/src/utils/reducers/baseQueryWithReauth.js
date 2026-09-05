import {fetchBaseQuery} from '@reduxjs/toolkit/query/react';
import {throwErrorWithCode} from '../miscellaneous';
import {getServerUrl} from '../serverUrl';
import {ensureFreshAccessToken, getAccessToken, hasAuthMarker, refreshAccessToken} from '../authTokens';
import {isPublicPath} from '../publicPath';

function getSentry() {
    return import('@sentry/react').catch(() => null);
}

if (process.env.NODE_ENV !== 'production') {
    console.log('API URL:', process.env.REACT_APP_BACKEND_URL);
}

const requestTimings = new Map();

const baseQuery = fetchBaseQuery({
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
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        return headers;
    },
});

const REDACTED_FIELDS = new Set([
    'password', 'current_password', 'new_password',
    'llm_api_key', 'strava_client_secret', 'email_host_password',
    'health_developer_password',
    'token', 'access_token', 'refresh_token',
    'p256dh', 'auth',
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

        // Web: httpOnly cookie may still be present even without a marker.
        // Native: secure store / marker. Always attempt one shared refresh.
        if (!getAccessToken() && !hasAuthMarker()) {
            // Still try cookie-based refresh once before giving up.
        }

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

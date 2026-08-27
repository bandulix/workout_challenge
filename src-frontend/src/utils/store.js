import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {setupListeners} from '@reduxjs/toolkit/query';
import {loadState, saveState} from './localStorage';
import {onAppResume} from './appLifecycle';
import {isNativeApp} from './platform';
import {workoutsApi} from './reducers/workoutsSlice';
import {usersApi} from './reducers/usersSlice';
import {competitionsApi} from "./reducers/competitionsSlice";
import {teamsApi} from "./reducers/teamsSlice";
import {goalsApi} from "./reducers/goalsSlice";
import {statsApi} from "./reducers/statsSlice";
import {feedApi} from "./reducers/feedSlice";
import {joinApi} from "./reducers/joinSlice";
import {linkApi} from "./reducers/linkSlice";
import {drillInstructorApi} from "./reducers/drillInstructorSlice";
import {siteSettingsApi} from "./reducers/siteSettingsSlice";
import {pushApi} from "./reducers/pushSlice";

const appReducer = combineReducers({
    [workoutsApi.reducerPath]: workoutsApi.reducer,
    [usersApi.reducerPath]: usersApi.reducer,
    [competitionsApi.reducerPath]: competitionsApi.reducer,
    [teamsApi.reducerPath]: teamsApi.reducer,
    [goalsApi.reducerPath]: goalsApi.reducer,
    [statsApi.reducerPath]: statsApi.reducer,
    [feedApi.reducerPath]: feedApi.reducer,
    [joinApi.reducerPath]: joinApi.reducer,
    [linkApi.reducerPath]: linkApi.reducer,
    [drillInstructorApi.reducerPath]: drillInstructorApi.reducer,
    [siteSettingsApi.reducerPath]: siteSettingsApi.reducer,
    [pushApi.reducerPath]: pushApi.reducer,
});

// root reducer that handles RESET_STORE
const rootReducer = (state, action) => {
    if (action.type === 'RESET_STORE') {
        state = undefined; // wipes the whole redux state, including RTK Query caches
    }
    return appReducer(state, action);
};

// Rehydrate fulfilled RTK Query entries so the APK paints last session's
// Coach/Home immediately, then mount/focus/reconnect revalidate.
// Only `fulfilled` rows with `data` are kept: a persisted `pending` entry
// can never resolve (its promise is gone) and used to freeze the UI.
function sanitizeApiSlice(slice) {
    if (!slice || typeof slice !== 'object') return undefined;
    const queries = {};
    for (const [key, entry] of Object.entries(slice.queries || {})) {
        if (entry?.status !== 'fulfilled' || entry.data === undefined) continue;
        queries[key] = {
            status: 'fulfilled',
            endpointName: entry.endpointName,
            originalArgs: entry.originalArgs,
            startedTimeStamp: entry.startedTimeStamp,
            fulfilledTimeStamp: entry.fulfilledTimeStamp,
            data: entry.data,
        };
    }
    if (Object.keys(queries).length === 0) return undefined;
    return {
        queries,
        mutations: {},
        provided: slice.provided || {},
        subscriptions: {},
        // Do not persist `config` (especially middlewareRegistered) -
        // rehydrating it makes the middleware skip setup on the next boot.
    };
}

function persistableState(state) {
    const persisted = {};
    for (const key of Object.keys(state)) {
        if (key.endsWith('Api')) {
            const clean = sanitizeApiSlice(state[key]);
            if (clean) persisted[key] = clean;
        } else {
            persisted[key] = state[key];
        }
    }
    return persisted;
}

const _persisted = loadState();
const preloadedState = _persisted
    ? persistableState(_persisted)
    : undefined;

const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware()
            .concat(workoutsApi.middleware)
            .concat(usersApi.middleware)
            .concat(competitionsApi.middleware)
            .concat(teamsApi.middleware)
            .concat(goalsApi.middleware)
            .concat(statsApi.middleware)
            .concat(feedApi.middleware)
            .concat(joinApi.middleware)
            .concat(linkApi.middleware)
            .concat(drillInstructorApi.middleware)
            .concat(siteSettingsApi.middleware)
            .concat(pushApi.middleware),
    preloadedState,
});

// Persisted-state writes are throttled: saveState serializes on EVERY
// dispatched action - with several polling loops that's many full
// JSON.stringify+setItem per minute on the main thread. 2s is plenty.
let saveStateTimer = null;
store.subscribe(() => {
    if (saveStateTimer !== null) return;
    saveStateTimer = setTimeout(() => {
        saveStateTimer = null;
        // Logout clears the refresh token then RESET_STORE; a pending
        // timer must not write the previous user's API cache back.
        if (!localStorage.getItem('refresh_token')) return;
        const full = persistableState(store.getState());
        if (!saveState(full)) {
            const slim = {...full};
            delete slim.feedApi;
            delete slim.statsApi;
            saveState(slim);
        }
    }, 2000);
});

setupListeners(store.dispatch);

// Android WebView often skips visibilitychange / window focus, so RTK's
// built-in refetchOnFocus never runs when the user comes back. Capacitor's
// appStateChange is the native equivalent of "the app is in front again".
if (isNativeApp()) {
    onAppResume(() => {
        // `onFocus` is not a public RTK Query export. The action lives
        // on each API slice (`__rtkq/focused`) and every slice listens.
        store.dispatch(usersApi.internalActions.onFocus());
    });
}

export default store;
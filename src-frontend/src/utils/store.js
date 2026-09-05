import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {setupListeners} from '@reduxjs/toolkit/query';
import {loadState, saveState} from './localStorage';
import {onAppResume} from './appLifecycle';
import {isNativeApp} from './platform';
import {getAccessToken, hasAuthMarker} from './authTokens';
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

const rootReducer = (state, action) => {
    if (action.type === 'RESET_STORE') {
        state = undefined;
    }
    return appReducer(state, action);
};

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
    };
}

function trimDrillMessages(data) {
    if (!data || Array.isArray(data)) return data;
    const rows = data.results;
    if (!Array.isArray(rows) || rows.length <= 15) return data;
    return {...data, results: rows.slice(0, 15)};
}

function trimWorkouts(data) {
    if (!Array.isArray(data) || data.length <= 40) return data;
    return data.slice(0, 40);
}

function persistableState(state) {
    const persisted = {};
    for (const key of Object.keys(state)) {
        if (key === "feedApi" || key === "statsApi") continue;
        if (key.endsWith('Api')) {
            const clean = sanitizeApiSlice(state[key]);
            if (!clean) continue;
            if (key === "drillInstructorApi") {
                for (const entry of Object.values(clean.queries)) {
                    if (entry.endpointName === "getDrillMessages") {
                        entry.data = trimDrillMessages(entry.data);
                    }
                }
            }
            if (key === "workoutsApi") {
                for (const entry of Object.values(clean.queries)) {
                    if (entry.endpointName === "getWorkouts") {
                        entry.data = trimWorkouts(entry.data);
                    }
                }
            }
            persisted[key] = clean;
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

let saveStateTimer = null;
store.subscribe(() => {
    if (saveStateTimer !== null) return;
    saveStateTimer = setTimeout(() => {
        saveStateTimer = null;
        // Do not persist API caches after logout (no access / auth marker).
        if (!getAccessToken() && !hasAuthMarker()) return;
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

if (isNativeApp()) {
    onAppResume(() => {
        store.dispatch(usersApi.internalActions.onFocus());
    });
}

export default store;

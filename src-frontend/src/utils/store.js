import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {loadState, saveState} from './localStorage';
import {setupListeners} from "@reduxjs/toolkit/query";
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

// Snapshots written by older builds still contain RTK API caches (the
// fossil this persistence removal targets) - drop those keys on READ as
// well, or affected installs keep the stale data forever.
const _persisted = loadState();
const preloadedState = _persisted
    ? Object.fromEntries(Object.entries(_persisted).filter(([key]) => !key.endsWith('Api')))
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
//
// RTK Query caches are deliberately NOT persisted: a rehydrated cache
// served days-old data in the long-lived Android WebView (including
// fossilized "pending" entries whose promise never resolved) - e.g. the
// coach config arrived without the capability flags and the roast box
// stayed hidden. Every query refetches on mount anyway; correctness
// beats the warm-start illusion. Only future non-API state is kept.
let saveStateTimer = null;
store.subscribe(() => {
    if (saveStateTimer !== null) return;
    saveStateTimer = setTimeout(() => {
        saveStateTimer = null;
        const state = store.getState();
        const persisted = {};
        for (const key of Object.keys(state)) {
            if (!key.endsWith('Api')) persisted[key] = state[key];
        }
        saveState(persisted);
    }, 2000);
});

setupListeners(store.dispatch);

export default store;
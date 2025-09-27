import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {loadState, saveState} from './localStorage';
import counterReducer from './reducers/counterSlice';
import authReducer from './reducers/authSlice';
import modalQueueReducer from './reducers/modalSlice';
import {setupListeners} from "@reduxjs/toolkit/query";
import {workoutsApi} from './reducers/workoutsSlice';
import {usersApi} from './reducers/usersSlice';
import {competitionsApi} from "./reducers/competitionsSlice";
import {teamsApi} from "./reducers/teamsSlice";
import {goalsApi} from "./reducers/goalsSlice";
import {pointsApi} from "./reducers/pointsSlice";
import {statsApi} from "./reducers/statsSlice";
import {feedApi} from "./reducers/feedSlice";
import {joinApi} from "./reducers/joinSlice";
import {linkApi} from "./reducers/linkSlice";

const appReducer = combineReducers({
    counter: counterReducer,
    auth: authReducer,
    modalQueue: modalQueueReducer,
    [workoutsApi.reducerPath]: workoutsApi.reducer,
    [usersApi.reducerPath]: usersApi.reducer,
    [competitionsApi.reducerPath]: competitionsApi.reducer,
    [teamsApi.reducerPath]: teamsApi.reducer,
    [goalsApi.reducerPath]: goalsApi.reducer,
    [pointsApi.reducerPath]: pointsApi.reducer,
    [statsApi.reducerPath]: statsApi.reducer,
    [feedApi.reducerPath]: feedApi.reducer,
    [joinApi.reducerPath]: joinApi.reducer,
    [linkApi.reducerPath]: linkApi.reducer,
});

// root reducer that handles RESET_STORE
const rootReducer = (state, action) => {
    if (action.type === 'RESET_STORE') {
        state = undefined; // wipes the whole redux state, including RTK Query caches
    }
    return appReducer(state, action);
};

const preloadedState = loadState();

const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware()
            .concat(workoutsApi.middleware)
            .concat(usersApi.middleware)
            .concat(competitionsApi.middleware)
            .concat(teamsApi.middleware)
            .concat(goalsApi.middleware)
            .concat(pointsApi.middleware)
            .concat(statsApi.middleware)
            .concat(feedApi.middleware)
            .concat(joinApi.middleware)
            .concat(linkApi.middleware),
    preloadedState,
});

store.subscribe(() => {
    saveState(store.getState());
});

setupListeners(store.dispatch);

export default store;
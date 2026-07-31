import {createSlice} from '@reduxjs/toolkit';


// Tokens live in localStorage and are *never* kept in the Redux store
// - the store is persisted by utils/localStorage.js and a poisoned
// appState row would otherwise leak the JWT through the same surface.
// The baseQueryWithReauth middleware reads directly from
// localStorage on every request so we don't need the values in state.
const authSlice = createSlice({
    name: 'auth',
    initialState: {
        isAuthenticated: !!localStorage.getItem('access_token'),
    },
    reducers: {
        setToken: (state, action) => {
            state.isAuthenticated = true;
            localStorage.setItem('refresh_token', action.payload.refreshToken);
            localStorage.setItem('access_token', action.payload.authToken);
        },
        updateToken: (state, action) => {
            state.isAuthenticated = true;
            localStorage.setItem('access_token', action.payload.authToken);
        },
        logout: (state) => {
            state.isAuthenticated = false;
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('access_token');
        },
    },
});

export const {setToken, updateToken, logout} = authSlice.actions;
export default authSlice.reducer;

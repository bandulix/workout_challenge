import {createSlice} from '@reduxjs/toolkit';


const authSlice = createSlice({
    name: 'auth',
    initialState: {
        authToken: null,
        refreshToken: null,
        isAuthenticated: false,
    },
    reducers: {
        setToken: (state, action) => {
            state.authToken = action.payload.authToken;
            state.refreshToken = action.payload.refreshToken;
            state.isAuthenticated = true;
            localStorage.setItem('refresh_token', action.payload.refreshToken);
            localStorage.setItem('access_token', action.payload.authToken);
        },
        updateToken: (state, action) => {
            state.authToken = action.payload.authToken;
            state.isAuthenticated = true;
            localStorage.setItem('access_token', action.payload.authToken);
        },
        logout: (state) => {
            state.authToken = null;
            state.refreshToken = null;
            state.isAuthenticated = false;
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('access_token');
        },
    },
});

export const {setToken, updateToken, logout} = authSlice.actions;
export default authSlice.reducer;

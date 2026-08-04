import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const linkApi = createApi({
    reducerPath: 'linkApi',
    baseQuery: baseQueryWithReauth,
    endpoints: (builder) => ({
        getStravaState: builder.query({
            query: () => ({
                url: `strava/state/`,
                method: 'GET',
            }),
        }),
        linkStrava: builder.mutation({
            query: ({code, state}) => ({
                url: `strava/link/${encodeURIComponent(code)}/${encodeURIComponent(state)}/`,
                method: 'POST',
            }),
        }),
        unlinkStrava: builder.mutation({
            query: () => ({
                url: `strava/unlink/`,
                method: 'POST',
            }),
        }),
        resetStrava: builder.mutation({
            query: () => ({
                url: `strava/reset/`,
                method: 'POST',
            }),
        }),
        syncStrava: builder.query({
            query: () => ({
                url: `strava/sync/`,
                method: 'GET',
            }),
        }),
        linkGarmin: builder.mutation({
            query: ({email, password}) => ({
                url: `garmin/link/`,
                method: 'POST',
                body: {email, password},
            }),
            invalidatesTags: [],
        }),
        unlinkGarmin: builder.mutation({
            query: () => ({
                url: `garmin/unlink/`,
                method: 'POST',
            }),
        }),
        syncGarmin: builder.query({
            query: () => ({
                url: `garmin/sync/`,
                method: 'GET',
            }),
        }),
        linkHealth: builder.mutation({
            query: () => ({
                url: `health/link/`,
                method: 'POST',
            }),
        }),
        unlinkHealth: builder.mutation({
            query: () => ({
                url: `health/unlink/`,
                method: 'POST',
            }),
        }),
        syncHealth: builder.query({
            query: () => ({
                url: `health/sync/`,
                method: 'GET',
            }),
        }),
    }),
});

export const {
    useGetStravaStateQuery,
    useLinkStravaMutation,
    useUnlinkStravaMutation,
    useResetStravaMutation,
    useGetSyncStravaQuery,
    useLazySyncStravaQuery,
    useLinkGarminMutation,
    useUnlinkGarminMutation,
    useGetSyncGarminQuery,
    useLazySyncGarminQuery,
    useLinkHealthMutation,
    useUnlinkHealthMutation,
    useGetSyncHealthQuery,
    useLazySyncHealthQuery,
} = linkApi;

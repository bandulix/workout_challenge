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
        // Mutations, not queries: a GET with side effects fired via a lazy
        // query gets deduped by RTK after the first click ("Re-Sync" did
        // nothing the second time). Mutations fire every time. (Still GET
        // on the wire for compatibility with older app builds.)
        syncStrava: builder.mutation({
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
        syncGarmin: builder.mutation({
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
        syncHealth: builder.mutation({
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
    useSyncStravaMutation,
    useLinkGarminMutation,
    useUnlinkGarminMutation,
    useSyncGarminMutation,
    useLinkHealthMutation,
    useUnlinkHealthMutation,
    useSyncHealthMutation,
} = linkApi;

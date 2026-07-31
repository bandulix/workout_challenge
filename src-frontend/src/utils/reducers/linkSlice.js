import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const linkApi = createApi({
    reducerPath: 'linkApi',
    baseQuery: baseQueryWithReauth,
    endpoints: (builder) => ({
        linkStrava: builder.mutation({
            query: (code) => ({
                url: `strava/link/${code}/`,
                method: 'POST',
            }),
        }),
        unlinkStrava: builder.mutation({
            query: () => ({
                url: `strava/unlink/`,
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
    }),
});

export const {
    useLinkStravaMutation,
    useUnlinkStravaMutation,
    useGetSyncStravaQuery,
    useLazySyncStravaQuery,
    useLinkGarminMutation,
    useUnlinkGarminMutation,
    useGetSyncGarminQuery,
    useLazySyncGarminQuery,
} = linkApi;

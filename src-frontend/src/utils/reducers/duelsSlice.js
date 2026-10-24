import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const duelsApi = createApi({
    reducerPath: 'duelsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Duel'],
    ...liveQueryDefaults,
    endpoints: (builder) => ({
        getMyDuels: builder.query({
            query: (competitionId) => ({
                url: competitionId ? `duels/?competition=${competitionId}` : 'duels/',
                method: 'GET',
            }),
            providesTags: ['Duel'],
        }),
        getDuel: builder.query({
            query: (id) => ({url: `duels/${id}/`, method: 'GET'}),
            providesTags: ['Duel'],
        }),
        createDuel: builder.mutation({
            query: ({competitionId, ...body}) => ({
                url: `competition/${competitionId}/duels/`,
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Duel'],
        }),
        respondDuel: builder.mutation({
            query: ({id, ...body}) => ({
                url: `duels/${id}/respond/`,
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Duel'],
        }),
        forfeitDuel: builder.mutation({
            query: ({id, action}) => ({
                url: `duels/${id}/forfeit/`,
                method: 'POST',
                body: {action},
            }),
            invalidatesTags: ['Duel'],
        }),
        rematchDuel: builder.mutation({
            query: (id) => ({
                url: `duels/${id}/rematch/`,
                method: 'POST',
            }),
            invalidatesTags: ['Duel'],
        }),
        blockDuel: builder.mutation({
            query: (userId) => ({
                url: 'duels/block/',
                method: 'POST',
                body: {user_id: userId},
            }),
            invalidatesTags: ['Duel'],
        }),
        unblockDuel: builder.mutation({
            query: (userId) => ({
                url: 'duels/block/',
                method: 'DELETE',
                body: {user_id: userId},
            }),
            invalidatesTags: ['Duel'],
        }),
        getDuelPings: builder.query({
            query: () => ({url: 'duels/pings/', method: 'GET'}),
        }),
        markDuelPingsSeen: builder.mutation({
            query: (ids) => ({
                url: 'duels/pings/',
                method: 'POST',
                body: {ids},
            }),
        }),
    }),
});

export const {
    useGetMyDuelsQuery,
    useGetDuelQuery,
    useCreateDuelMutation,
    useRespondDuelMutation,
    useForfeitDuelMutation,
    useRematchDuelMutation,
    useBlockDuelMutation,
    useUnblockDuelMutation,
} = duelsApi;

import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const joinApi = createApi({
    reducerPath: 'joinApi',
    baseQuery: baseQueryWithReauth,
    endpoints: (builder) => ({
        joinCompetition: builder.mutation({
            query: (join_code) => ({
                url: `join/competition/${join_code}/`,
                method: 'POST',
            }),
        }),
        leaveCompetition: builder.mutation({
            query: (id) => ({
                url: `join/competition/${id}/`,
                method: 'DELETE',
            }),
        }),
        joinTeam: builder.mutation({
            query: (params = {}) => ({
                url: `join/team/`,
                method: 'POST',
                params: params,
            }),
        }),
    }),
});

export const {
    useJoinCompetitionMutation,
    useLeaveCompetitionMutation,
    useJoinTeamMutation,
} = joinApi;
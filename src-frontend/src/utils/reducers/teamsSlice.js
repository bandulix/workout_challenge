import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const teamsApi = createApi({
    reducerPath: 'teamsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Team'],
    ...liveQueryDefaults,
    endpoints: (builder) => ({
        getTeams: builder.query({
            query: (params = {}) => ({
                url: `team/`, //?${new URLSearchParams(params).toString()}
                method: 'GET',
                params: params,
            }),
            providesTags: (result = []) => result.length ? [...result.map(({id}) => ({ type: 'Team', id })), { type: 'Team' }] : [{ type: 'Team' }],
        }),
        getTeamById: builder.query({
            query: (id) => ({
                url: `team/${id}/`,
                method: 'GET',
            }),
            providesTags: (result, error, id) => [{type: 'Team', id}],
        }),
        addTeam: builder.mutation({
            query: (newTeam) => ({
                url: 'team/',
                method: 'POST',
                body: newTeam,
            }),
            invalidatesTags: ['Team'],
        }),
        updateTeam: builder.mutation({
            query: ({id, ...patch}) => ({
                url: `team/${id}/`,
                method: 'PATCH',
                body: patch,
            }),
            invalidatesTags: (result, error, {id}) => [{type: 'Team', id}],
        }),
        deleteTeam: builder.mutation({
            query: (id) => ({
                url: `team/${id}/`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, id) => [{type: 'Team', id}],
        }),
    }),
});

export const {
    useGetTeamsQuery,
    useAddTeamMutation,
    useUpdateTeamMutation,
    useDeleteTeamMutation,
} = teamsApi;
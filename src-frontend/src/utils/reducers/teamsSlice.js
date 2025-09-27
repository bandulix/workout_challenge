import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const teamsApi = createApi({
    reducerPath: 'teamsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Team'],
    keepUnusedDataFor: 60 * 60 * 12, // 12 hours cache (default is 60)
    refetchOnMountOrArgChange: 60 * 60, // Refetch if older than 1 hour
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
    useGetTeamByIdQuery,
    useAddTeamMutation,
    useUpdateTeamMutation,
    useDeleteTeamMutation,
} = teamsApi;
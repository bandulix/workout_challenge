import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const competitionsApi = createApi({
    reducerPath: 'competitionsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Competition'],
    ...liveQueryDefaults,
    endpoints: (builder) => ({
        getCompetitions: builder.query({
            query: (params = {}) => ({
                url: `competition/`, //?${new URLSearchParams(params).toString()}
                method: 'GET',
                params: params,
            }),
            providesTags: (result = []) => result.length ? [...result.map(({id}) => ({ type: 'Competition', id })), { type: 'Competition' }] : [{ type: 'Competition' }],
        }),
        getCompetitionById: builder.query({
            query: (id) => ({
                url: `competition/${id}/`,
                method: 'GET',
            }),
            providesTags: (result, error, id) => [{type: 'Competition', id}],
        }),
        // Site-wide per-activity-type point multipliers (admin-edited) -
        // read by the challenge "How points work" view.
        getPointsFactors: builder.query({
            query: () => ({url: 'points-factors/', method: 'GET'}),
        }),
        addCompetition: builder.mutation({
            query: (newCompetition) => ({
                url: 'competition/',
                method: 'POST',
                body: newCompetition,
            }),
            invalidatesTags: ['Competition'],
        }),
        updateCompetition: builder.mutation({
            query: ({id, ...patch}) => ({
                url: `competition/${id}/`,
                method: 'PATCH',
                body: patch,
            }),
            invalidatesTags: (result, error, {id}) => [{type: 'Competition', id}],
        }),
        deleteCompetition: builder.mutation({
            query: (id) => ({
                url: `competition/${id}/`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, id) => [{type: 'Competition', id}],
        }),
    }),
});

export const {
    useGetCompetitionsQuery,
    useGetCompetitionByIdQuery,
    useAddCompetitionMutation,
    useUpdateCompetitionMutation,
    useDeleteCompetitionMutation,
} = competitionsApi;
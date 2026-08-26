import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const competitionsApi = createApi({
    reducerPath: 'competitionsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Competition'],
    keepUnusedDataFor: 60 * 60 * 12, // 12 hours cache (default is 60s)
    refetchOnMountOrArgChange: 60, // Refetch if older than 60 seconds (multi-device sync)
    endpoints: (builder) => ({
        getCompetitions: builder.query({
            query: (params = {}) => ({
                url: `competition/`, //?${new URLSearchParams(params).toString()}
                method: 'GET',
                params: params,
            }),
            // The Android WebView parks its renderer when hidden, so the
            // 60s poll doesn't necessarily fire while the user looks at
            // the dashboard - a freshly created challenge then stayed
            // invisible. Always refetch on (re)mount; the dashboard is
            // the landing page, so every navigation home reloads it.
            refetchOnMountOrArgChange: true,
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
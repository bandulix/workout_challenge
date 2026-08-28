import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const statsApi = createApi({
    reducerPath: 'statsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Stats'],
    ...liveQueryDefaults,
    endpoints: (builder) => ({
        getStatsById: builder.query({
            query: (id) => ({
                url: `stats/${id}/`,
                method: 'GET',
            }),
            providesTags: (result, error, id) => [{type: 'Stats', id}],
        }),
        getStatsSummaryById: builder.query({
            query: (id) => ({
                url: `stats/${id}/summary/`,
                method: 'GET',
            }),
            providesTags: (result, error, id) => [{type: 'Stats', id}],
        }),
    }),
});

export const {
    useGetStatsByIdQuery,
    useGetStatsSummaryByIdQuery,
} = statsApi;
import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const statsApi = createApi({
    reducerPath: 'statsApi',
    baseQuery: baseQueryWithReauth,
    keepUnusedDataFor: 60 * 60 * 3, // 3 hours cache (default is 60)
    refetchOnMountOrArgChange: 60 * 15, // Refetch if older than 15 minutes
    endpoints: (builder) => ({
        getStatsById: builder.query({
            query: (id) => ({
                url: `stats/${id}/`,
                method: 'GET',
            }),
            providesTags: (result, error, id) => [{type: 'Stats', id}],
        }),
    }),
});

export const {
    useGetStatsByIdQuery,
} = statsApi;
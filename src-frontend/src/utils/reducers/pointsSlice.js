import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const pointsApi = createApi({
    reducerPath: 'pointsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Point'],
    keepUnusedDataFor: 60 * 60 * 3, // 3 hours cache (default is 60)
    refetchOnMountOrArgChange: 60 * 15, // Refetch if older than 15 minutes
    endpoints: (builder) => ({
        getPoints: builder.query({
            query: (params = {}) => ({
                url: `point/`, //?${new URLSearchParams(params).toString()}
                method: 'GET',
                params: params,
            }),
            providesTags: (result = []) => result.length ? [...result.map(({id}) => ({ type: 'Point', id })), { type: 'Point' }] : [{ type: 'Point' }],
        }),
        getPointById: builder.query({
            query: (id) => ({
                url: `point/${id}/`,
                method: 'GET',
            }),
            providesTags: (result, error, id) => [{type: 'Point', id}],
        }),
    }),
});

export const {
    useGetPointsQuery,
    useGetPointByIdQuery,
} = pointsApi;
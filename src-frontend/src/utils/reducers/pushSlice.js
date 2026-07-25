import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const pushApi = createApi({
    reducerPath: 'pushApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['PushStatus'],
    keepUnusedDataFor: 60 * 5,
    endpoints: (builder) => ({
        getPushStatus: builder.query({
            query: () => ({url: 'push/status/', method: 'GET'}),
            providesTags: ['PushStatus'],
        }),
        subscribePush: builder.mutation({
            query: (payload) => ({
                url: 'push/subscribe/',
                method: 'POST',
                body: payload,
            }),
            invalidatesTags: ['PushStatus'],
        }),
        unsubscribePush: builder.mutation({
            query: (payload) => ({
                url: 'push/unsubscribe/',
                method: 'POST',
                body: payload,
            }),
            invalidatesTags: ['PushStatus'],
        }),
    }),
});

export const {
    useGetPushStatusQuery,
    useSubscribePushMutation,
    useUnsubscribePushMutation,
} = pushApi;
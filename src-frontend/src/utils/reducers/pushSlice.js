import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const pushApi = createApi({
    reducerPath: 'pushApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['PushStatus'],
    ...liveQueryDefaults,
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
        testPush: builder.mutation({
            query: () => ({
                url: 'push/test/',
                method: 'POST',
            }),
        }),
    }),
});

export const {
    useGetPushStatusQuery,
    useSubscribePushMutation,
    useUnsubscribePushMutation,
    useTestPushMutation,
} = pushApi;
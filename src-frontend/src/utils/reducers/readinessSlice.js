import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const readinessApi = createApi({
    reducerPath: 'readinessApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Readiness', 'ReadinessSetting'],
    ...liveQueryDefaults,
    endpoints: (builder) => ({
        getReadinessToday: builder.query({
            query: (arg) => ({
                url: 'readiness/today/',
                method: 'GET',
                params: arg?.competition ? {competition: arg.competition} : undefined,
            }),
            providesTags: ['Readiness'],
        }),
        saveReadinessPreferences: builder.mutation({
            query: (body) => ({
                url: 'readiness/preferences/',
                method: 'PUT',
                body,
            }),
            invalidatesTags: ['Readiness'],
        }),
        saveCheckIn: builder.mutation({
            query: (body) => ({
                url: 'readiness/check-in/',
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Readiness'],
        }),
        deleteReadinessData: builder.mutation({
            query: () => ({
                url: 'readiness/data/',
                method: 'DELETE',
            }),
            invalidatesTags: ['Readiness'],
        }),
        ackReadinessNotice: builder.mutation({
            query: () => ({
                url: 'readiness/notice/ack/',
                method: 'POST',
            }),
            invalidatesTags: ['Readiness'],
        }),
        getChallengeReadiness: builder.query({
            query: (competitionId) => ({
                url: `readiness/challenge/${competitionId}/`,
                method: 'GET',
            }),
            providesTags: ['ReadinessSetting'],
        }),
        updateChallengeReadiness: builder.mutation({
            query: ({competitionId, body}) => ({
                url: `readiness/challenge/${competitionId}/`,
                method: 'PATCH',
                body,
            }),
            invalidatesTags: ['ReadinessSetting'],
        }),
    }),
});

export const {
    useGetReadinessTodayQuery,
    useSaveReadinessPreferencesMutation,
    useSaveCheckInMutation,
    useDeleteReadinessDataMutation,
    useAckReadinessNoticeMutation,
    useGetChallengeReadinessQuery,
    useUpdateChallengeReadinessMutation,
} = readinessApi;

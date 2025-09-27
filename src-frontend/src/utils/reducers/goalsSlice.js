import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const goalsApi = createApi({
    reducerPath: 'goalsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Goal'],
    keepUnusedDataFor: 60 * 60 * 12, // 12 hours cache (default is 60)
    refetchOnMountOrArgChange: 60 * 60 * 3, // Refetch if older than 3 hours
    endpoints: (builder) => ({
        getGoals: builder.query({
            query: (params = {}) => ({
                url: `goal/`, //?${new URLSearchParams(params).toString()}
                method: 'GET',
                params: params,
            }),
            providesTags: (result = []) => result.length ? [...result.map(({id}) => ({ type: 'Goal', id })), { type: 'Goal' }] : [{ type: 'Goal' }],
        }),
        getGoalById: builder.query({
            query: (id) => ({
                url: `goal/${id}/`,
                method: 'GET',
            }),
            providesTags: (result, error, id) => [{type: 'Goal', id}],
        }),
        addGoal: builder.mutation({
            query: (newGoal) => ({
                url: 'goal/',
                method: 'POST',
                body: newGoal,
            }),
            invalidatesTags: ['Goal'],
        }),
        updateGoal: builder.mutation({
            query: ({id, ...patch}) => ({
                url: `goal/${id}/`,
                method: 'PATCH',
                body: patch,
            }),
            invalidatesTags: (result, error, {id}) => [{type: 'Goal', id}],
        }),
        deleteGoal: builder.mutation({
            query: (id) => ({
                url: `goal/${id}/`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, id) => [{type: 'Goal', id}],
        }),
    }),
});

export const {
    useGetGoalsQuery,
    useGetGoalByIdQuery,
    useAddGoalMutation,
    useUpdateGoalMutation,
    useDeleteGoalMutation,
} = goalsApi;
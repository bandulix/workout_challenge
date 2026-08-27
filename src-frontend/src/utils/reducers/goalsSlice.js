import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const goalsApi = createApi({
    reducerPath: 'goalsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Goal'],
    ...liveQueryDefaults,
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
    useAddGoalMutation,
    useUpdateGoalMutation,
    useDeleteGoalMutation,
} = goalsApi;
import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {convertToLocalTimezone, dateFormatter} from "./workoutsSlice";
import {liveQueryDefaults} from './rtkDefaults';

export const feedApi = createApi({
    reducerPath: 'feedApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['Feed'],
    ...liveQueryDefaults,
    endpoints: (builder) => ({
        getFeedById: builder.query({
            query: (id) => ({
                url: `feed/${id}/`,
                method: 'GET',
                params: {limit: 15, offset: 0},
            }),
            transformResponse: (response) => {
                const decorate = (activity) => ({
                    ...activity,
                    workout__start_datetime_fmt: dateFormatter(activity.workout__start_datetime, activity.workout__sport_type === 'Steps'),
                    workout__start_datetime: convertToLocalTimezone(activity.workout__start_datetime, activity.workout__sport_type === 'Steps'),
                });
                if (Array.isArray(response)) return response.map(decorate);
                return {
                    ...response,
                    results: (response.results || []).map(decorate),
                };
            },
            providesTags: (result, error, id) => [{type: 'Feed', id}],
        }),
    }),
});

export const {
    useGetFeedByIdQuery,
} = feedApi;
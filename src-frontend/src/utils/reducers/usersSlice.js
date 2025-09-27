import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {convertToLocalTimezone, dateFormatter} from "./workoutsSlice";

export const usersApi = createApi({
    reducerPath: 'usersApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['User'],
    keepUnusedDataFor: 60 * 60 * 12, // 12 hours cache (default is 60s)
    refetchOnMountOrArgChange: 60 * 60 * 3, // Refetch if older than 3 hours
    endpoints: (builder) => ({
        getUsers: builder.query({
            query: (params = {}) => ({
                url: `user/`, //?${new URLSearchParams(params).toString()}
                method: 'GET',
                params: params,
            }),
            transformResponse: (response) => {
                return response.map(user => {
                    return {
                        ...user,
                        strava_last_synced_at_fmt: dateFormatter(user.strava_last_synced_at), // format datetime
                        strava_last_synced_at: convertToLocalTimezone(user.strava_last_synced_at), // convert to local timezone
                    };
                });
            },
            providesTags: (result = []) => {
                const tags = result.map(({ id }) => ({ type: 'User', id }));
                if (result.some(user => user.id === 'me')) {
                    tags.push({ type: 'User', id: 'me' });
                }
                tags.push({ type: 'User' });
                return tags;
            },
        }),
        getUserById: builder.query({
            query: (id) => ({
                url: `user/${id}/`,
                method: 'GET',
            }),
            transformResponse: (response) => {
                return {
                    ...response,
                    strava_last_synced_at_fmt: dateFormatter(response.strava_last_synced_at),
                    strava_last_synced_at: convertToLocalTimezone(response.strava_last_synced_at),
                };
            },
            providesTags: (result, error, id) => {
                const tags = [{ type: 'User', id }];
                if (id === 'me') {
                    tags.push({ type: 'User', id: 'me' });
                }
                return tags;
            },
        }),
        addUser: builder.mutation({
            query: (newUser) => ({
                url: 'user/',
                method: 'POST',
                body: newUser,
            }),
            invalidatesTags: ['User'],
        }),
        updateUser: builder.mutation({
            query: ({id, ...patch}) => ({
                url: `user/${id}/`,
                method: 'PATCH',
                body: patch,
            }),
            invalidatesTags: (result, error, {id}) => {
                const tags = [{ type: 'User', id }];
                if (result?.my === true) {
                    tags.push({ type: 'User', id: 'me' });
                }
                return tags;
            },
        }),
        deleteUser: builder.mutation({
            query: (id) => ({
                url: `user/${id}/`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, id) => {
                const tags = [{ type: 'User', id }];
                if (id === 'me') {
                    tags.push({ type: 'User', id: 'me' });
                }
                return tags;
            },
        }),
    }),
});

export const {
    useGetUsersQuery,
    useGetUserByIdQuery,
    useAddUserMutation,
    useUpdateUserMutation,
    useDeleteUserMutation,
} = usersApi;
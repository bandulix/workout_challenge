import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const siteSettingsApi = createApi({
    reducerPath: 'siteSettingsApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['SiteSettings'],
    ...liveQueryDefaults,
    endpoints: (builder) => ({
        getSiteSettings: builder.query({
            query: () => ({url: 'site-settings/', method: 'GET'}),
            providesTags: ['SiteSettings'],
        }),
        updateSiteSettings: builder.mutation({
            query: (patch) => ({
                url: 'site-settings/',
                method: 'PUT',
                body: patch,
            }),
            invalidatesTags: ['SiteSettings'],
        }),
    }),
});

export const {
    useGetSiteSettingsQuery,
    useUpdateSiteSettingsMutation,
} = siteSettingsApi;
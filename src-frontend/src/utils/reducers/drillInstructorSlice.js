import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const drillInstructorApi = createApi({
    reducerPath: 'drillInstructorApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['DrillPersona', 'DrillConfig', 'DrillMessage'],
    keepUnusedDataFor: 60 * 60 * 12,
    refetchOnMountOrArgChange: 60, // 60 seconds - the drill instructor's active state must not look "forgotten" on a second device
    endpoints: (builder) => ({
        // ---- Personas ---------------------------------------------------
        getPersonas: builder.query({
            query: (params = {}) => ({
                url: 'drill-instructor/persona/',
                method: 'GET',
                params,
            }),
            providesTags: (result = []) => result.length
                ? [...result.map(({id}) => ({type: 'DrillPersona', id})), {type: 'DrillPersona'}]
                : [{type: 'DrillPersona'}],
        }),
        getPersonaById: builder.query({
            query: (id) => ({url: `drill-instructor/persona/${id}/`, method: 'GET'}),
            providesTags: (result, error, id) => [{type: 'DrillPersona', id}],
        }),
        addPersona: builder.mutation({
            // Body is plain JSON, or FormData when a custom profile
            // picture file rides along (multipart boundary via browser).
            query: (newPersona) => ({
                url: 'drill-instructor/persona/',
                method: 'POST',
                body: newPersona,
                ...(newPersona instanceof FormData ? {headers: {'X-Skip-Content-Type': '1'}} : {}),
            }),
            invalidatesTags: ['DrillPersona'],
        }),
        updatePersona: builder.mutation({
            query: ({id, body}) => ({
                url: `drill-instructor/persona/${id}/`,
                method: 'PATCH',
                body,
                ...(body instanceof FormData ? {headers: {'X-Skip-Content-Type': '1'}} : {}),
            }),
            invalidatesTags: (result, error, {id}) => [{type: 'DrillPersona', id}, 'DrillPersona'],
        }),
        deletePersona: builder.mutation({
            query: (id) => ({
                url: `drill-instructor/persona/${id}/`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, id) => [{type: 'DrillPersona', id}, 'DrillPersona'],
        }),

        // ---- Configs ----------------------------------------------------
        getDrillConfigs: builder.query({
            query: (params = {}) => ({
                url: 'drill-instructor/config/',
                method: 'GET',
                params,
            }),
            providesTags: (result = []) => result.length
                ? [...result.map(({id}) => ({type: 'DrillConfig', id})), {type: 'DrillConfig'}]
                : [{type: 'DrillConfig'}],
        }),
        getDrillConfigById: builder.query({
            query: (id) => ({url: `drill-instructor/config/${id}/`, method: 'GET'}),
            providesTags: (result, error, id) => [{type: 'DrillConfig', id}],
        }),
        addDrillConfig: builder.mutation({
            query: (newConfig) => ({
                url: 'drill-instructor/config/',
                method: 'POST',
                body: newConfig,
            }),
            invalidatesTags: ['DrillConfig'],
        }),
        updateDrillConfig: builder.mutation({
            query: ({id, ...patch}) => ({
                url: `drill-instructor/config/${id}/`,
                method: 'PATCH',
                body: patch,
            }),
            invalidatesTags: (result, error, {id}) => [{type: 'DrillConfig', id}, 'DrillConfig'],
        }),
        deleteDrillConfig: builder.mutation({
            query: (id) => ({
                url: `drill-instructor/config/${id}/`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, id) => [{type: 'DrillConfig', id}, 'DrillConfig'],
        }),

        // ---- Messages ---------------------------------------------------
        getDrillMessages: builder.query({
            query: (params = {}) => ({
                url: 'drill-instructor/message/',
                method: 'GET',
                params,
            }),
            providesTags: (result = []) => result.length
                ? [...result.map(({id}) => ({type: 'DrillMessage', id})), {type: 'DrillMessage'}]
                : [{type: 'DrillMessage'}],
        }),
        replyToDrillMessage: builder.mutation({
            // Participant's reply under a coach message; the coach's
            // reaction is generated server-side in the background.
            query: ({id, body}) => ({
                url: `drill-instructor/message/${id}/reply/`,
                method: 'POST',
                body: {body},
            }),
            invalidatesTags: ['DrillMessage'],
        }),

        // ---- Test message (Celery task runner) -------------------------
        runTestMessage: builder.mutation({
            query: ({config_id, body}) => ({
                url: `drill-instructor/config/${config_id}/test/`,
                method: 'POST',
                body: {body},
            }),
        }),
    }),
});

export const {
    useGetPersonasQuery,
    useGetPersonaByIdQuery,
    useAddPersonaMutation,
    useUpdatePersonaMutation,
    useDeletePersonaMutation,
    useGetDrillConfigsQuery,
    useGetDrillConfigByIdQuery,
    useAddDrillConfigMutation,
    useUpdateDrillConfigMutation,
    useDeleteDrillConfigMutation,
    useGetDrillMessagesQuery,
    useReplyToDrillMessageMutation,
    useRunTestMessageMutation,
} = drillInstructorApi;

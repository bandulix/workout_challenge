import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';

export const drillInstructorApi = createApi({
    reducerPath: 'drillInstructorApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['DrillPersona', 'DrillConfig', 'DrillMessage', 'DrillRoast'],
    keepUnusedDataFor: 60 * 60 * 12,
    // Always refetch on (re)mount: the Android WebView parks its renderer
    // when hidden, so timed polls don't fire reliably in the app - and a
    // stale config (e.g. vision_capable=false from before the admin fixed
    // the model) then sticks for days. These endpoints are tiny.
    refetchOnMountOrArgChange: true,
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
        postDrillPhoto: builder.mutation({
            // Participant's photo post (multipart; image is compressed
            // before upload - see utils/imageCompress.js). With `parent`
            // the photo answers that thread (Coach page: the coach's
            // latest message); without it, it opens a new thread. The
            // coach's reaction is generated server-side in the background.
            query: ({competition, parent, image, caption}) => {
                const form = new FormData();
                if (parent) form.append('parent', String(parent));
                else form.append('competition', String(competition));
                form.append('image', image);
                if (caption) form.append('caption', caption);
                return {
                    url: 'drill-instructor/message/photo/',
                    method: 'POST',
                    body: form,
                    headers: {'X-Skip-Content-Type': '1'},
                };
            },
            invalidatesTags: ['DrillMessage'],
        }),

        // ---- Roast swipe box (hot-or-not) ------------------------------
        getRoasts: builder.query({
            query: () => ({url: 'drill-instructor/message/roasts/', method: 'GET'}),
            providesTags: ['DrillRoast'],
        }),
        voteRoast: builder.mutation({
            query: ({id, hot}) => ({
                url: `drill-instructor/message/${id}/vote/`,
                method: 'POST',
                body: {hot},
            }),
            // No refetch: the swipe box applies votes optimistically.
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
    useAddPersonaMutation,
    useUpdatePersonaMutation,
    useDeletePersonaMutation,
    useGetDrillConfigsQuery,
    useAddDrillConfigMutation,
    useUpdateDrillConfigMutation,
    useDeleteDrillConfigMutation,
    useGetDrillMessagesQuery,
    useReplyToDrillMessageMutation,
    usePostDrillPhotoMutation,
    useGetRoastsQuery,
    useVoteRoastMutation,
    useRunTestMessageMutation,
} = drillInstructorApi;

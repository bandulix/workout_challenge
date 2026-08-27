import {createApi} from '@reduxjs/toolkit/query/react';
import {baseQueryWithReauth} from './baseQueryWithReauth';
import {liveQueryDefaults} from './rtkDefaults';

export const drillInstructorApi = createApi({
    reducerPath: 'drillInstructorApi',
    baseQuery: baseQueryWithReauth,
    tagTypes: ['DrillPersona', 'DrillConfig', 'DrillMessage', 'DrillRoast', 'DrillBallot', 'DrillEcho'],
    ...liveQueryDefaults,
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
        reactToActivity: builder.mutation({
            query: ({id, emoji}) => ({
                url: `drill-instructor/message/${id}/react/`,
                method: 'POST',
                body: {emoji},
            }),
            // Patch every cached feed instead of invalidating — a refetch
            // would fight the optimistic chip and the 60s poll already
            // picks up everyone else's stamps.
            async onQueryStarted({id}, {dispatch, queryFulfilled, getState}) {
                try {
                    const {data} = await queryFulfilled;
                    if (!data?.reacts) return;
                    const argsList = drillInstructorApi.util.selectCachedArgsForQuery(
                        getState(),
                        "getDrillMessages",
                    );
                    for (const arg of argsList) {
                        dispatch(
                            drillInstructorApi.util.updateQueryData(
                                "getDrillMessages",
                                arg,
                                (draft) => {
                                    if (!Array.isArray(draft)) return;
                                    const row = draft.find((m) => m.id === id);
                                    if (row) row.reacts = data.reacts;
                                },
                            ),
                        );
                    }
                } catch {
                    // Component rolls the chip back.
                }
            },
        }),
        postDrillPhoto: builder.mutation({
            // Participant's photo post (multipart; image is compressed
            // before upload - see utils/imageCompress.js). `parent` or
            // `competition` picks the challenge; the server hangs the
            // picture under the caller's latest own workout comment.
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
            invalidatesTags: ['DrillMessage', 'DrillRoast'],
        }),

        // ---- Roast swipe box (hot-or-not) ------------------------------
        getRoasts: builder.query({
            query: () => ({url: 'drill-instructor/message/roasts/', method: 'GET'}),
            providesTags: ['DrillRoast'],
        }),
        getHallOfRoasts: builder.query({
            query: (competition) => ({
                url: 'drill-instructor/message/hall/',
                method: 'GET',
                params: competition ? {competition} : {},
            }),
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

        // ---- Weekly coach vote -----------------------------------------
        getCoachBallot: builder.query({
            query: (configId) => ({
                url: `drill-instructor/config/${configId}/ballot/`,
                method: "GET",
            }),
            providesTags: (result, error, configId) => [{type: "DrillBallot", id: configId}, "DrillBallot"],
        }),
        voteCoachPersona: builder.mutation({
            query: ({configId, persona}) => ({
                url: `drill-instructor/config/${configId}/vote/`,
                method: "POST",
                body: {persona},
            }),
            invalidatesTags: (result, error, {configId}) => [{type: "DrillBallot", id: configId}],
        }),

        // ---- Legend Echoes ---------------------------------------------
        getEchoes: builder.query({
            query: (params = {}) => ({
                url: "drill-instructor/echoes/",
                method: "GET",
                params,
            }),
            providesTags: (result = []) => result.length
                ? [...result.map(({id}) => ({type: "DrillEcho", id})), {type: "DrillEcho"}]
                : [{type: "DrillEcho"}],
        }),
        getEchoBook: builder.query({
            query: (competition) => ({
                url: "drill-instructor/echoes/book/",
                method: "GET",
                params: {competition},
            }),
            providesTags: ["DrillEcho"],
        }),
        challengeEcho: builder.mutation({
            query: (id) => ({
                url: `drill-instructor/echoes/${id}/challenge/`,
                method: "POST",
            }),
            invalidatesTags: (result, error, id) => [
                {type: "DrillEcho", id},
                "DrillEcho",
                "DrillMessage",
            ],
        }),
        deleteEcho: builder.mutation({
            query: (id) => ({
                url: `drill-instructor/echoes/${id}/`,
                method: "DELETE",
            }),
            invalidatesTags: (result, error, id) => [
                {type: "DrillEcho", id},
                "DrillEcho",
                "DrillMessage",
            ],
        }),
        uploadEchoArt: builder.mutation({
            query: ({id, image}) => {
                const form = new FormData();
                form.append("image", image);
                return {
                    url: `drill-instructor/echoes/${id}/art/`,
                    method: "POST",
                    body: form,
                    headers: {"X-Skip-Content-Type": "1"},
                };
            },
            invalidatesTags: (result, error, {id}) => [
                {type: "DrillEcho", id},
                "DrillEcho",
                "DrillMessage",
            ],
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
    useReactToActivityMutation,
    usePostDrillPhotoMutation,
    useGetRoastsQuery,
    useGetHallOfRoastsQuery,
    useVoteRoastMutation,
    useGetCoachBallotQuery,
    useVoteCoachPersonaMutation,
    useGetEchoesQuery,
    useGetEchoBookQuery,
    useChallengeEchoMutation,
    useDeleteEchoMutation,
    useUploadEchoArtMutation,
    useRunTestMessageMutation,
} = drillInstructorApi;

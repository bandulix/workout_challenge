import React, {useEffect, useMemo, useState} from "react";
import {
    useAddDrillConfigMutation,
    useDeleteDrillConfigMutation,
    useGetDrillConfigsQuery,
    useGetPersonasQuery,
    useRunTestMessageMutation,
    useUpdateDrillConfigMutation,
} from "../utils/reducers/drillInstructorSlice";
import {BeatLoader} from "react-spinners";
import {DeleteButton, Modal, SaveButton} from "./basicComponents";

const PLACEHOLDER_BODY = "AI Drill Instructor standing by. Drop a workout to see me in action.";

function Field({label, required, error, hint, children}) {
    return (
        <div className="px-4 w-full">
            <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                {label}{required ? "*" : ""}
                {error && <span className="text-red-600 font-normal italic"> ({error})</span>}
            </label>
            {children}
            {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
        </div>
    );
}

export default function DrillInstructorConfigForm({competition, setModalState}) {
    const {data: personas, isLoading: personasLoading} = useGetPersonasQuery();
    const {data: configs, isLoading: configsLoading, refetch: refetchConfigs} = useGetDrillConfigsQuery();
    const [addDrillConfig, {isLoading: addLoading, error: addError}] = useAddDrillConfigMutation();
    const [updateDrillConfig, {isLoading: updateLoading, error: updateError}] = useUpdateDrillConfigMutation();
    const [deleteDrillConfig, {isLoading: deleteLoading}] = useDeleteDrillConfigMutation();
    const [runTestMessage, {isLoading: testLoading, data: testData, error: testError}] = useRunTestMessageMutation();

    const existing = useMemo(
        () => (configs || []).find((cfg) => cfg.competition === competition.id) || null,
        [configs, competition.id],
    );

    const [enabled, setEnabled] = useState(false);
    const [persona, setPersona] = useState("");
    const [matrixHomeserver, setMatrixHomeserver] = useState("https://matrix.org");
    const [matrixAccessToken, setMatrixAccessToken] = useState("");
    const [matrixRoomId, setMatrixRoomId] = useState("");
    const [matrixBotDisplayName, setMatrixBotDisplayName] = useState("");
    const [commentOnActivity, setCommentOnActivity] = useState(true);
    const [sendPushOnActivity, setSendPushOnActivity] = useState(false);
    const [testBody, setTestBody] = useState(PLACEHOLDER_BODY);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState("");

    useEffect(() => {
        if (existing) {
            setEnabled(!!existing.enabled);
            setPersona(existing.persona ?? "");
            setMatrixHomeserver(existing.matrix_homeserver || "https://matrix.org");
            setMatrixAccessToken(""); // never repopulate the real token
            setMatrixRoomId(existing.matrix_room_id || "");
            setMatrixBotDisplayName(existing.matrix_bot_display_name || "");
            setCommentOnActivity(!!existing.comment_on_activity);
            setSendPushOnActivity(!!existing.send_push_on_activity);
        }
    }, [existing]);

    useEffect(() => {
        if (addError) setFormError("Create Error: " + JSON.stringify(addError?.data || addError?.message));
        if (updateError) setFormError("Update Error: " + JSON.stringify(updateError?.data || updateError?.message));
    }, [addError, updateError]);

    async function handleSubmit() {
        setFieldErrors({});
        setFormError("");
        const payload = {
            competition: competition.id,
            enabled,
            persona,
            matrix_homeserver: matrixHomeserver,
            matrix_room_id: matrixRoomId,
            matrix_bot_display_name: matrixBotDisplayName,
            comment_on_activity: commentOnActivity,
            send_push_on_activity: sendPushOnActivity,
        };
        if (matrixAccessToken) payload.matrix_access_token = matrixAccessToken;

        try {
            if (existing) {
                await updateDrillConfig({id: existing.id, ...payload}).unwrap();
            } else {
                await addDrillConfig(payload).unwrap();
            }
            await refetchConfigs();
            setModalState(false);
            document.body.classList.remove("body-no-scroll");
            window.alert(existing ? "Saved." : "Drill Instructor created.");
        } catch (err) {
            console.error("Config save failed", err);
            setFieldErrors(err?.data || {});
        }
    }

    async function handleDelete() {
        if (!existing) return;
        const confirmation = window.confirm("Remove the Drill Instructor from this competition?");
        if (!confirmation) return;
        try {
            await deleteDrillConfig(existing.id).unwrap();
            await refetchConfigs();
            setModalState(false);
            document.body.classList.remove("body-no-scroll");
        } catch (err) {
            window.alert("Could not delete: " + JSON.stringify(err?.data || err?.message));
        }
    }

    async function handleTest() {
        if (!existing) {
            window.alert("Save the configuration first before sending a test message.");
            return;
        }
        try {
            const res = await runTestMessage({config_id: existing.id, body: testBody || PLACEHOLDER_BODY}).unwrap();
            if (res?.error) {
                window.alert("Matrix rejected the test message: " + res.error);
            } else {
                window.alert("Test message posted (event id: " + (res?.event_id || "n/a") + ").");
            }
        } catch (err) {
            window.alert("Failed to run test task: " + JSON.stringify(err?.data || err?.message));
        }
    }

    const personasList = personas || [];
    const tokenDisplay = existing?.access_token_masked || "(not set)";

    return (
        <Modal title="AI Drill Instructor" landscape={true} setShowModal={setModalState} isLoading={configsLoading || personasLoading || addLoading || updateLoading || deleteLoading}>
            <div className="text-sm text-gray-600 dark:text-gray-400 px-4 pb-3">
                Connect a Matrix room and the instructor will comment on every activity logged during
                this competition using the chosen persona.
            </div>

            <Field label="Enabled" error={fieldErrors.enabled}>
                <label className="inline-flex items-center text-gray-700 dark:text-gray-300 text-sm">
                    <input
                        type="checkbox"
                        className="mr-2 leading-tight"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                    />
                    Activate the Drill Instructor for this competition
                </label>
            </Field>

            <Field label="Persona" required error={fieldErrors.persona} hint="Defines the voice and style.">
                <select
                    className="w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-gray-800 dark:text-gray-400 leading-tight focus:outline-none focus:shadow-outline"
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                >
                    <option value="">Select a persona</option>
                    {personasList.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name}{p.is_builtin ? " (built-in)" : ""} — {p.description}
                        </option>
                    ))}
                </select>
            </Field>

            <Field label="Matrix Homeserver URL" required error={fieldErrors.matrix_homeserver} hint="e.g. https://matrix.org or your self-hosted Synapse.">
                <input
                    type="text"
                    className="w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-gray-900 dark:text-gray-400 leading-tight focus:outline-none focus:shadow-outline"
                    value={matrixHomeserver}
                    onChange={(e) => setMatrixHomeserver(e.target.value)}
                    placeholder="https://matrix.org"
                />
            </Field>

            <Field label={existing ? "Matrix Access Token (leave blank to keep current)" : "Matrix Access Token"}
                   required={!existing}
                   error={fieldErrors.matrix_access_token}
                   hint={`Current token stored: ${tokenDisplay}. Get a new one from Element → Settings → Help → Access Token.`}>
                <input
                    type="password"
                    autoComplete="off"
                    className="w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-gray-900 dark:text-gray-400 leading-tight focus:outline-none focus:shadow-outline"
                    value={matrixAccessToken}
                    onChange={(e) => setMatrixAccessToken(e.target.value)}
                    placeholder="syt_…"
                />
            </Field>

            <Field label="Matrix Room ID" required error={fieldErrors.matrix_room_id} hint="Looks like !abc123:matrix.org. The bot must already be a member of the room.">
                <input
                    type="text"
                    className="w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-gray-900 dark:text-gray-400 leading-tight focus:outline-none focus:shadow-outline"
                    value={matrixRoomId}
                    onChange={(e) => setMatrixRoomId(e.target.value)}
                    placeholder="!abcdef123456:matrix.org"
                />
            </Field>

            <Field label="Display Name Prefix" error={fieldErrors.matrix_bot_display_name} hint="Optional. Prepended in [brackets] so people know it's the bot.">
                <input
                    type="text"
                    className="w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-gray-900 dark:text-gray-400 leading-tight focus:outline-none focus:shadow-outline"
                    value={matrixBotDisplayName}
                    onChange={(e) => setMatrixBotDisplayName(e.target.value)}
                    placeholder="Drill Sergeant"
                />
            </Field>

            <Field label="Comment on each activity" error={fieldErrors.comment_on_activity}>
                <label className="inline-flex items-center text-gray-700 dark:text-gray-300 text-sm">
                    <input
                        type="checkbox"
                        className="mr-2 leading-tight"
                        checked={commentOnActivity}
                        onChange={(e) => setCommentOnActivity(e.target.checked)}
                    />
                    Post a comment in Matrix every time a participant logs a workout
                </label>
            </Field>

            <Field label="Browser push for participants" error={fieldErrors.send_push_on_activity}
                   hint="Participants must have enabled browser push in the Site Settings to receive these.">
                <label className="inline-flex items-center text-gray-700 dark:text-gray-300 text-sm">
                    <input
                        type="checkbox"
                        className="mr-2 leading-tight"
                        checked={sendPushOnActivity}
                        onChange={(e) => setSendPushOnActivity(e.target.checked)}
                    />
                    Also send a browser push notification to every subscribed participant
                </label>
            </Field>

            {existing && (
                <div className="px-4 w-full mt-3">
                    <div className="text-xs text-gray-500 italic">
                        Messages posted: {existing.messages_posted ?? 0}
                        {existing.last_posted_at && (
                            <> · Last posted: {new Date(existing.last_posted_at).toLocaleString()}</>
                        )}
                        {existing.last_error && (
                            <div className="text-red-500 mt-1">Last error: {existing.last_error}</div>
                        )}
                    </div>
                </div>
            )}

            {existing && (
                <div className="px-4 w-full mt-4 border-t pt-3 border-gray-200 dark:border-gray-700">
                    <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                        Send a test message
                    </label>
                    <div className="flex flex-wrap gap-2 items-start">
                        <input
                            type="text"
                            className="flex-1 min-w-[16rem] shadow border rounded py-2 px-3 text-gray-700 dark:bg-gray-900 dark:text-gray-400 leading-tight focus:outline-none focus:shadow-outline"
                            value={testBody}
                            onChange={(e) => setTestBody(e.target.value)}
                        />
                        <button
                            onClick={handleTest}
                            disabled={testLoading}
                            className="px-4 py-2 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-semibold"
                        >
                            {testLoading ? <BeatLoader size={6} color="rgb(209 213 219)"/> : "Send"}
                        </button>
                    </div>
                    {testError && (
                        <div className="text-red-500 text-xs italic mt-1">
                            {JSON.stringify(testError?.data || testError?.message)}
                        </div>
                    )}
                </div>
            )}

            <div className="text-center text-red-500 text-xs italic mt-3">{formError}</div>

            <div className="relative flex justify-between items-center mt-4">
                {existing ? (
                    <DeleteButton onClick={handleDelete} label="Remove Drill Instructor" highlighted={false} larger={true}/>
                ) : (
                    <span/>
                )}
                <SaveButton onClick={handleSubmit} label={existing ? "Update" : "Create"} highlighted={true} larger={true}/>
            </div>
        </Modal>
    );
}

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
import PersonaAvatar from "../components/PersonaAvatar";
import {confirmAction, notice} from "../utils/dialogs";

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
    const [runTestMessage, {isLoading: testLoading, error: testError}] = useRunTestMessageMutation();

    const existing = useMemo(
        () => (configs || []).find((cfg) => cfg.competition === competition.id) || null,
        [configs, competition.id],
    );

    // Activate already meant "turn it on" - default checked for a new
    // config so the owner is not asked twice, then left with a benched coach.
    const [enabled, setEnabled] = useState(true);
    const [persona, setPersona] = useState("");
    const [commentOnActivity, setCommentOnActivity] = useState(true);
    const [nudgeOnInactivity, setNudgeOnInactivity] = useState(true);
    const [randomPush, setRandomPush] = useState(true);
    const [sendPushOnActivity, setSendPushOnActivity] = useState(false);
    const [testBody, setTestBody] = useState(PLACEHOLDER_BODY);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState("");

    useEffect(() => {
        if (existing) {
            setEnabled(!!existing.enabled);
            setPersona(existing.persona ?? "");
            setCommentOnActivity(!!existing.comment_on_activity);
            setNudgeOnInactivity(existing.nudge_on_inactivity !== false);
            setRandomPush(existing.random_push !== false);
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
            comment_on_activity: commentOnActivity,
            nudge_on_inactivity: nudgeOnInactivity,
            random_push: randomPush,
            send_push_on_activity: sendPushOnActivity,
        };

        try {
            if (existing) {
                await updateDrillConfig({id: existing.id, ...payload}).unwrap();
            } else {
                await addDrillConfig(payload).unwrap();
            }
            await refetchConfigs();
            setModalState(false);
            document.body.classList.remove("body-no-scroll");
            await notice(existing ? "Saved." : "Drill Instructor created.");
        } catch (err) {
            console.error("Config save failed", err);
            setFieldErrors(err?.data || {});
            // A failed save must be unmistakable - e.g. enabling without
            // picking a persona only showed a small inline error before,
            // which read as "the app forgot my activation".
            await notice("Could not save the Drill Instructor config: " + JSON.stringify(err?.data || err?.message));
        }
    }

    async function handleDelete() {
        if (!existing) return;
        const confirmation = await confirmAction("Remove the Drill Instructor from this competition?");
        if (!confirmation) return;
        try {
            await deleteDrillConfig(existing.id).unwrap();
            await refetchConfigs();
            setModalState(false);
            document.body.classList.remove("body-no-scroll");
        } catch (err) {
            await notice("Could not delete: " + JSON.stringify(err?.data || err?.message));
        }
    }

    async function handleTest() {
        if (!existing) {
            await notice("Save the configuration first before sending a test message.");
            return;
        }
        try {
            const res = await runTestMessage({config_id: existing.id, body: testBody || PLACEHOLDER_BODY}).unwrap();
            if (res?.error) {
                await notice("Drill Instructor could not save the test message: " + res.error);
            } else {
                await notice("Test message saved to the audit log (id " + (res?.id || "n/a") + ").");
            }
        } catch (err) {
            await notice("Failed to run test task: " + JSON.stringify(err?.data || err?.message));
        }
    }

    const personasList = personas || [];

    return (
        <Modal title="AI Drill Instructor" landscape={true} setShowModal={setModalState} isLoading={configsLoading || personasLoading || addLoading || updateLoading || deleteLoading}>
            <div className="text-sm text-gray-600 dark:text-gray-400 px-4 pb-3">
                Pick the starting coach. Everyone in the challenge can vote for next week's
                instructor - the winner takes over each Monday morning. Generated comments land
                in Coach's Corner (and optionally as a push).
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

            <Field label="Persona" required error={fieldErrors.persona} hint="Built-ins plus any roaster you created from Settings.">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {personasList.map((p) => {
                        const selected = String(persona) === String(p.id);
                        return (
                            <button key={p.id} type="button" onClick={() => setPersona(p.id)}
                                    aria-label={p.name}
                                    aria-pressed={selected}
                                    className={"flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition active:scale-[0.97] " +
                                        (selected
                                            ? "border-volt-500 bg-volt-400/15 dark:bg-volt-400/10 shadow-glow-volt"
                                            : "border-gray-200 dark:border-ink-700/60 hover:border-volt-500/60")}>
                                <PersonaAvatar persona={p} size={56} glow={selected}/>
                                <div>
                                    <p className="text-sm font-bold leading-tight">{p.name}</p>
                                    <p className="text-[11px] text-gray-400 italic leading-tight mt-0.5">{p.tagline || p.description}</p>
                                    {p.mine && <p className="text-[10px] font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300 mt-1">Yours</p>}
                                </div>
                            </button>
                        );
                    })}
                </div>
                {personasList.length === 0 && (
                    <p className="text-sm text-gray-500">No personas available yet.</p>
                )}
            </Field>

            <Field label="Comment on each activity" error={fieldErrors.comment_on_activity}>
                <label className="inline-flex items-center text-gray-700 dark:text-gray-300 text-sm">
                    <input
                        type="checkbox"
                        className="mr-2 leading-tight"
                        checked={commentOnActivity}
                        onChange={(e) => setCommentOnActivity(e.target.checked)}
                    />
                    Generate a comment for every workout logged in this competition
                </label>
            </Field>

            <Field label="Nudge when the group goes quiet" error={fieldErrors.nudge_on_inactivity}
                   hint="If a whole day passes without any workout in a running competition, the instructor posts one motivational nudge to keep the group active.">
                <label className="inline-flex items-center text-gray-700 dark:text-gray-300 text-sm">
                    <input
                        type="checkbox"
                        className="mr-2 leading-tight"
                        checked={nudgeOnInactivity}
                        onChange={(e) => setNudgeOnInactivity(e.target.checked)}
                    />
                    Post a daily nudge when nobody logged a workout
                </label>
            </Field>

            <Field label="Push the group at random times" error={fieldErrors.random_push}
                   hint="The instructor posts 1-2 persona-voiced pep talks per day at random times (between 07:00 and 22:00), independent of whether anyone trained.">
                <label className="inline-flex items-center text-gray-700 dark:text-gray-300 text-sm">
                    <input
                        type="checkbox"
                        className="mr-2 leading-tight"
                        checked={randomPush}
                        onChange={(e) => setRandomPush(e.target.checked)}
                    />
                    Daily pep talks at random times (1-2 per day)
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
                        Messages generated: {existing.messages_posted ?? 0}
                        {existing.last_posted_at && (
                            <> · Last generated: {new Date(existing.last_posted_at).toLocaleString()}</>
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
                        Preview a test message
                    </label>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        Pick a persona, save, then send a one-off test message here. It will be
                        saved to the audit log so you can see exactly how the instructor would
                        talk to your participants.
                    </div>
                    <div className="flex flex-wrap gap-2 items-start">
                        <input
                            type="text"
                            className="flex-1 min-w-[16rem] shadow border border-gray-200 dark:border-ink-700/60 rounded-xl py-2 px-3 text-gray-700 dark:bg-ink-900 dark:text-gray-300 leading-tight focus:outline-none focus:border-volt-500"
                            value={testBody}
                            onChange={(e) => setTestBody(e.target.value)}
                        />
                        <button
                            onClick={handleTest}
                            disabled={testLoading}
                            className="px-4 py-2 rounded-full btn-glass text-sm font-semibold transition"
                        >
                            {testLoading ? <BeatLoader size={6} color="#d7ff3e"/> : "Send"}
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

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
import {FIELD_INPUT_CLASS, Modal, SaveButton} from "./basicComponents";
import PersonaAvatar from "../components/PersonaAvatar";
import {confirmAction, notice} from "../utils/dialogs";

const PLACEHOLDER_BODY = "AI Drill Instructor standing by. Drop a workout to see me in action.";


function SettingsGroup({title, hint, children}) {
    return (
        <section className="rounded-2xl glass-inset p-4 space-y-3">
            <div>
                <h3 className="font-display text-xs uppercase tracking-[0.16em]">{title}</h3>
                {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

function ToggleRow({on, onChange, label, hint, error}) {
    return (
        <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
                className="w-full text-left rounded-2xl glass-card px-3.5 py-3 flex items-start gap-3 transition active:scale-[0.99]">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-950 dark:text-gray-100">{label}</p>
                {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{hint}</p>}
                {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
            </div>
            <span aria-hidden="true"
                  className={"mt-0.5 shrink-0 h-6 w-11 rounded-full p-0.5 transition " +
                      (on ? "bg-volt-400 shadow-glow-volt" : "bg-ink-950/15 dark:bg-ink-700")}>
                <span className={"block h-5 w-5 rounded-full bg-white shadow transition-transform " +
                    (on ? "translate-x-5" : "translate-x-0")}/>
            </span>
        </button>
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
            <SettingsGroup title="On duty"
                           hint="Pick the starting coach. Everyone in the challenge can vote for next week's instructor — the winner takes over each Monday. Comments land in the feed, and optionally as a push.">
                <ToggleRow
                    on={enabled}
                    onChange={setEnabled}
                    label="Activate the coach for this challenge"
                    hint={enabled ? "On duty — comments and nudges go out." : "Benched — the coach stays quiet."}
                    error={fieldErrors.enabled}
                />
                {existing && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 px-0.5">
                        {existing.messages_posted ?? 0} {(existing.messages_posted === 1) ? "message" : "messages"} posted
                        {existing.last_posted_at && <> · last {new Date(existing.last_posted_at).toLocaleString()}</>}
                    </p>
                )}
                {existing?.last_error && (
                    <p className="text-xs text-red-500">Last error: {existing.last_error}</p>
                )}
            </SettingsGroup>

            <SettingsGroup title="Starting coach" hint="Built-ins plus any roaster you created from Settings.">
                {fieldErrors.persona && (
                    <p className="text-xs text-red-500">Persona {String(fieldErrors.persona)}</p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {personasList.map((p) => {
                        const selected = String(persona) === String(p.id);
                        return (
                            <button key={p.id} type="button" onClick={() => setPersona(p.id)}
                                    aria-label={p.name}
                                    aria-pressed={selected}
                                    className={"flex flex-col items-center gap-2 rounded-2xl p-3 text-center transition active:scale-[0.97] " +
                                        (selected
                                            ? "bg-volt-400/15 dark:bg-volt-400/10 shadow-glow-volt ring-1 ring-volt-500"
                                            : "glass-card hover:ring-1 hover:ring-volt-500/50")}>
                                <PersonaAvatar persona={p} size={56} glow={selected}/>
                                <div className="min-w-0 w-full">
                                    <p className="text-sm font-bold leading-tight truncate">{p.name}</p>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 italic leading-tight mt-0.5 line-clamp-2">
                                        {p.tagline || p.description}
                                    </p>
                                    {p.mine && (
                                        <p className="text-[10px] font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300 mt-1">Yours</p>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
                {personasList.length === 0 && (
                    <p className="text-sm text-gray-500">No personas available yet.</p>
                )}
            </SettingsGroup>

            <SettingsGroup title="What the coach does">
                <ToggleRow
                    on={commentOnActivity}
                    onChange={setCommentOnActivity}
                    label="Comment on each workout"
                    hint="A persona-voiced line after every activity logged in this challenge."
                    error={fieldErrors.comment_on_activity}
                />
                <ToggleRow
                    on={nudgeOnInactivity}
                    onChange={setNudgeOnInactivity}
                    label="Nudge when the group goes quiet"
                    hint="If a whole day passes with no workout, one motivational post keeps the field honest."
                    error={fieldErrors.nudge_on_inactivity}
                />
                <ToggleRow
                    on={randomPush}
                    onChange={setRandomPush}
                    label="Pep talks at random times"
                    hint="1–2 persona-voiced pings per day between 07:00 and 22:00, whether anyone trained or not."
                    error={fieldErrors.random_push}
                />
                <ToggleRow
                    on={sendPushOnActivity}
                    onChange={setSendPushOnActivity}
                    label="Browser push for participants"
                    hint="Also ping every subscribed phone. People opt in from Home."
                    error={fieldErrors.send_push_on_activity}
                />
            </SettingsGroup>

            {existing && (
                <SettingsGroup title="Preview a test message"
                               hint="Saved to the audit log so you can hear exactly how this coach would talk.">
                    <div className="flex flex-wrap gap-2 items-center">
                        <input
                            type="text"
                            className={FIELD_INPUT_CLASS + " flex-1 min-w-[12rem]"}
                            value={testBody}
                            onChange={(e) => setTestBody(e.target.value)}
                            aria-label="Test message"
                        />
                        <button type="button" onClick={handleTest} disabled={testLoading}
                                className="shrink-0 min-h-[44px] px-5 rounded-full bg-volt-400 text-ink-950 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none">
                            {testLoading ? <BeatLoader size={6} color="#0b0b0c"/> : "Send"}
                        </button>
                    </div>
                    {testError && (
                        <p className="text-xs text-red-500 italic">
                            {JSON.stringify(testError?.data || testError?.message)}
                        </p>
                    )}
                </SettingsGroup>
            )}

            {formError && <p className="text-center text-red-500 text-xs italic">{formError}</p>}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                {existing ? (
                    <button type="button" onClick={handleDelete}
                            className="text-sm font-semibold text-red-500 dark:text-red-400 hover:underline px-1 min-h-[44px]">
                        Remove coach
                    </button>
                ) : (
                    <span/>
                )}
                <SaveButton onClick={handleSubmit} label={existing ? "Save" : "Activate"} highlighted={true} larger={true}/>
            </div>
        </Modal>
    );
}

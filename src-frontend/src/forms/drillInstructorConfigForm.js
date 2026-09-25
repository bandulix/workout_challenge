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
import {FIELD_INPUT_CLASS, Modal, SaveButton, useFormDirty} from "./basicComponents";
import PersonaAvatar from "../components/PersonaAvatar";
import {confirmAction, notice} from "../utils/dialogs";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";
import {clearBodyScrollLock} from "../utils/overlay";
import {PersonaEditModal} from "./drillInstructorPersonaModal";

const PLACEHOLDER_BODY = "Your coach standing by. Drop a workout to see me in action.";


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
    const {data: personas, isLoading: personasLoading, refetch: refetchPersonas} = useGetPersonasQuery();
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
    const [showPersonaEditor, setShowPersonaEditor] = useState(false);
    const [commentOnActivity, setCommentOnActivity] = useState(true);
    const [nudgeOnInactivity, setNudgeOnInactivity] = useState(true);
    const [randomPush, setRandomPush] = useState(true);
    const [sendPushOnActivity, setSendPushOnActivity] = useState(false);
    const [dailyPrompt, setDailyPrompt] = useState("");
    const [testBody, setTestBody] = useState(PLACEHOLDER_BODY);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState("");

    const [initialSnapshot, setInitialSnapshot] = useState(null);
    useEffect(() => {
        if (existing) {
            setEnabled(!!existing.enabled);
            setPersona(existing.persona ?? "");
            setCommentOnActivity(!!existing.comment_on_activity);
            setNudgeOnInactivity(existing.nudge_on_inactivity !== false);
            setRandomPush(existing.random_push !== false);
            setSendPushOnActivity(!!existing.send_push_on_activity);
            setDailyPrompt(existing.daily_prompt || "");
            setInitialSnapshot({
                enabled: !!existing.enabled,
                persona: existing.persona ?? "",
                commentOnActivity: !!existing.comment_on_activity,
                nudgeOnInactivity: existing.nudge_on_inactivity !== false,
                randomPush: existing.random_push !== false,
                sendPushOnActivity: !!existing.send_push_on_activity,
                dailyPrompt: existing.daily_prompt || "",
            });
        }
    }, [existing]);

    useEffect(() => {
        if (addError) setFormError(errText(addError, "Could not create the coach. Please try again."));
        if (updateError) setFormError(errText(updateError, "Could not save the coach. Please try again."));
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
            daily_prompt: dailyPrompt.trim(),
        };

        try {
            if (existing) {
                await updateDrillConfig({id: existing.id, body: payload}).unwrap();
            } else {
                await addDrillConfig(payload).unwrap();
            }
            await refetchConfigs();
            setModalState(false);
            clearBodyScrollLock();
            toast.success(existing ? "Saved." : "Coach created.");
        } catch (err) {
            console.error("Config save failed", err);
            setFieldErrors(err?.data || {});
            // A failed save must be unmistakable - e.g. enabling without
            // picking a persona only showed a small inline error before,
            // which read as "the app forgot my activation".
            await notice(errText(err, "Could not save the coach. Pick a persona and try again."));
        }
    }

    async function handleDelete() {
        if (!existing) return;
        const confirmation = await confirmAction("Remove the coach from this challenge?");
        if (!confirmation) return;
        try {
            await deleteDrillConfig(existing.id).unwrap();
            await refetchConfigs();
            setModalState(false);
            clearBodyScrollLock();
        } catch (err) {
            await notice(errText(err, "Could not remove the coach. Please try again."));
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
                await notice("The coach could not save the test message: " + res.error);
            } else {
                await notice("Test message saved to the audit log (id " + (res?.id || "n/a") + ").");
            }
        } catch (err) {
            await notice(errText(err, "Failed to run the test message. Please try again."));
        }
    }

    const personasList = personas || [];

    return (
        <Modal title="Coach" landscape={true} setShowModal={setModalState}
               isLoading={configsLoading || personasLoading || addLoading || updateLoading || deleteLoading}
               confirmDiscard={useFormDirty(
                   {enabled, persona, commentOnActivity, nudgeOnInactivity, randomPush, sendPushOnActivity, dailyPrompt},
                   initialSnapshot,
               )}>
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

            <SettingsGroup title="Starting coach" hint="Built-ins, coaches you made, and any a teammate released for others to use.">
                {fieldErrors.persona && (
                    <p className="text-xs text-red-500" role="alert">Coach: {String(fieldErrors.persona)}</p>
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
                                    {!p.mine && p.is_shared && (
                                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mt-1">
                                            From {p.created_by_name || "a teammate"}
                                        </p>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
                {personasList.length === 0 && (
                    /* Dead end no more: creating a coach from here keeps the
                       activation flow alive. */
                    <div className="rounded-2xl glass-well p-4 text-center">
                        <p className="text-sm text-gray-500 dark:text-gray-400">No coaches yet.</p>
                        <button type="button" onClick={() => setShowPersonaEditor(true)}
                                className="mt-2 inline-flex min-h-[44px] items-center rounded-full bg-volt-400 text-ink-950 px-4 py-2 text-xs font-bold uppercase tracking-wide hover:bg-volt-300 transition">
                            Create your coach
                        </button>
                    </div>
                )}
            </SettingsGroup>

            <SettingsGroup title="What the coach does">
                <ToggleRow
                    on={commentOnActivity}
                    onChange={setCommentOnActivity}
                    label="Comment on each workout"
                    hint="A coach-voiced line after every activity logged in this challenge."
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
                    hint="One coach-voiced ping per day between 07:00 and 22:00, whether anyone trained or not."
                    error={fieldErrors.random_push}
                />
                <ToggleRow
                    on={sendPushOnActivity}
                    onChange={setSendPushOnActivity}
                    label="Browser push for participants"
                    hint="Also ping every subscribed phone. People opt in from Home."
                    error={fieldErrors.send_push_on_activity}
                />
                <div className="rounded-2xl glass-card px-3.5 py-3">
                    <label htmlFor="daily-prompt" className="text-sm font-semibold text-ink-950 dark:text-gray-100">
                        Daily briefing — your instruction to the AI
                    </label>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        Sent to the AI <b>exactly as you write it (1:1)</b>, every morning — the coach
                        answers in its own persona and builds on yesterday's post instead of repeating
                        it (a third day without snow worries it more than the first). Empty means no
                        briefing.
                    </p>
                    <ul className="mt-1.5 list-disc pl-4 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed space-y-0.5">
                        <li>The coach already knows its own name and personality, and the challenge's
                            name — you can write things like “Sign off as {existing?.persona_detail?.name || "your coach name"}”
                            or “{competition?.name ? `Open with the day 3 weather worry for ${competition.name}` : "Open with today's plan"}”.</li>
                        <li>Format and length are yours: “Always 3 bullet points”, “Max one sentence”, “End with a dare”.</li>
                        <li>It can't fetch live data (weather, snow, results) — it says so in persona
                            instead of inventing numbers.</li>
                    </ul>
                    <textarea
                        id="daily-prompt"
                        rows={3}
                        maxLength={500}
                        className={FIELD_INPUT_CLASS + " mt-2 w-full resize-none"}
                        placeholder={"e.g. Post a morning motivation about the snow at Corviglia. Sign off with your coach name. Always end with one concrete workout dare."}
                        value={dailyPrompt}
                        onChange={(e) => setDailyPrompt(e.target.value)}
                    />
                    {fieldErrors.daily_prompt && (
                        <p className="mt-1 text-xs text-red-500">{String(fieldErrors.daily_prompt)}</p>
                    )}
                </div>
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
                            {errText(testError, "The test message failed. Please try again.")}
                        </p>
                    )}
                </SettingsGroup>
            )}

            {formError && <p className="text-center text-danger-text text-xs italic">{formError}</p>}

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
            {showPersonaEditor && (
                <PersonaEditModal persona={{}} setModalState={(open) => {
                    if (open === false) {
                        setShowPersonaEditor(false);
                        refetchPersonas();
                    }
                }}/>
            )}
        </Modal>
    );
}

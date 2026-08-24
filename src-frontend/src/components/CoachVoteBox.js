import React, {useEffect, useState} from "react";
import {Timer, Vote} from "lucide-react";
import PersonaAvatar from "./PersonaAvatar";
import {BoxSection} from "../utils/miscellaneous";
import {useGetCoachBallotQuery, useVoteCoachPersonaMutation} from "../utils/reducers/drillInstructorSlice";
import usePollingInterval from "../utils/usePollingInterval";

function formatCountdown(iso, now) {
    if (!iso) return "";
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return "any moment";
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}

function useNowTick(active) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!active) return undefined;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [active]);
    return now;
}

export function CoachHandover({configId, enabled}) {
    const poll = usePollingInterval(60000);
    const {data: ballot} = useGetCoachBallotQuery(configId, {
        pollingInterval: poll,
        skip: !configId,
    });
    const now = useNowTick(Boolean(ballot?.next_switch_at));
    if (!enabled || !ballot?.changed_this_term) return null;
    const current = (ballot.candidates || []).find((c) => c.persona.id === ballot.current_persona)?.persona;
    if (!current) return null;
    const previous = ballot.previous_persona;
    const countdown = formatCountdown(ballot.next_switch_at, now);
    return (
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-ink-700/60">
            <div className="rounded-2xl bg-gray-100 text-ink-950 dark:bg-ink-900 dark:text-white px-3.5 py-3 border border-volt-500/50 dark:border-volt-400/40">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-volt-700 dark:text-volt-400 flex items-center gap-1.5">
                    <Timer className="h-3.5 w-3.5"/> New coach
                </p>
                <div className="mt-2 flex items-center gap-3">
                    {previous && (
                        <>
                            <PersonaAvatar persona={previous} size={36}/>
                            <span className="text-gray-500 text-sm">→</span>
                        </>
                    )}
                    <PersonaAvatar persona={current} size={44} glow/>
                    <div className="min-w-0">
                        <p className="font-display text-sm uppercase tracking-wide truncate">{current.name}</p>
                        <p className="text-[11px] text-gray-600 dark:text-gray-400">
                            {previous ? `took over from ${previous.name}` : "took the megaphone"}
                        </p>
                    </div>
                </div>
                <p className="mt-2 text-xs text-volt-700 dark:text-volt-300 font-bold uppercase tracking-wider tabular-nums">
                    On the clock · {countdown}
                </p>
            </div>
        </div>
    );
}

export default function CoachVoteBox({configs, preferredConfigId}) {
    const votable = (configs || []).filter((c) => c.enabled);
    const [pickedId, setPickedId] = useState(null);
    const configId = votable.some((c) => c.id === pickedId)
        ? pickedId
        : (votable.some((c) => c.id === preferredConfigId) ? preferredConfigId : votable[0]?.id);

    const poll = usePollingInterval(60000);
    const {data: ballot} = useGetCoachBallotQuery(configId, {
        pollingInterval: poll,
        skip: !configId,
    });
    const [vote, {isLoading}] = useVoteCoachPersonaMutation();
    const now = useNowTick(Boolean(ballot?.next_switch_at));

    if (!configId || !ballot) return null;

    const countdown = formatCountdown(ballot.next_switch_at, now);
    const tiedLeaders = (ballot.candidates || []).filter((c) => c.leading && c.votes > 0).length > 1;

    async function pick(personaId) {
        if (isLoading || personaId === ballot.my_vote) return;
        try {
            await vote({configId, persona: personaId}).unwrap();
        } catch (err) {
            console.error("Coach vote failed", err);
        }
    }

    return (
        <BoxSection>
            <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <Vote className="h-3.5 w-3.5 text-volt-500"/> Vote next week's coach
                </p>
                <p className="text-[11px] font-bold uppercase tracking-wider text-volt-700 dark:text-volt-300 tabular-nums shrink-0">
                    {countdown}
                </p>
            </div>
            {votable.length > 1 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
                    {votable.map((c) => {
                        const on = c.id === configId;
                        return (
                            <button key={c.id} type="button" onClick={() => setPickedId(c.id)}
                                    className={"shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide min-h-[36px] transition " +
                                        (on ? "bg-volt-400 text-ink-950 shadow-glow-volt" : "btn-glass")}>
                                {c.competition_name || "Challenge"}
                            </button>
                        );
                    })}
                </div>
            )}
            <p className="text-[11px] text-gray-400 mt-1">
                {ballot.vote_count === 0
                    ? "No votes yet. Winner takes over Monday morning."
                    : `${ballot.vote_count} ${ballot.vote_count === 1 ? "vote" : "votes"} in · switches ${countdown === "any moment" ? "now" : "in " + countdown}.`}
                {" "}You can change your vote until the switch.
                {tiedLeaders ? " Tied coaches are drawn at random." : ""}
            </p>
            {ballot.my_vote && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Your pick is highlighted. Tap another coach to switch.
                </p>
            )}

            <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">
                {(ballot.candidates || []).map((c) => {
                    const selected = ballot.my_vote === c.persona.id;
                    const onDuty = ballot.current_persona === c.persona.id;
                    return (
                        <button key={c.persona.id} type="button" onClick={() => pick(c.persona.id)}
                                disabled={isLoading}
                                className={"snap-start shrink-0 w-[6.5rem] rounded-2xl border p-2.5 text-center transition active:scale-[0.97] disabled:opacity-60 " +
                                    (selected
                                        ? "border-volt-500 bg-volt-400/15 dark:bg-volt-400/10 shadow-glow-volt"
                                        : "border-gray-200 dark:border-ink-700/60 hover:border-volt-500/60")}>
                            <PersonaAvatar persona={c.persona} size={44} glow={selected || onDuty} className="mx-auto"/>
                            <p className="mt-1.5 text-[11px] font-bold leading-tight truncate">{c.persona.name}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                                {c.votes} {c.votes === 1 ? "vote" : "votes"}
                                {c.leading && c.votes > 0 ? (tiedLeaders ? " · tie" : " · lead") : ""}
                            </p>
                            {selected ? (
                                <p className="text-[9px] font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300 mt-0.5">Your vote</p>
                            ) : onDuty ? (
                                <p className="text-[9px] font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300 mt-0.5">On duty</p>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </BoxSection>
    );
}

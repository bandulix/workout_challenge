import React, {useEffect, useState} from "react";
import {Timer} from "lucide-react";
import PersonaAvatar from "./PersonaAvatar";
import {PaneHead} from "./uiBits";
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
    const until = ballot?.handover_until;
    const now = useNowTick(Boolean(until));
    const recently = Boolean(ballot?.changed_recently ?? ballot?.changed_this_term);
    if (!enabled || !recently || (until && new Date(until).getTime() <= now)) return null;
    const current = (ballot.candidates || []).find((c) => c.persona.id === ballot.current_persona)?.persona;
    if (!current) return null;
    const previous = ballot.previous_persona;
    const countdown = formatCountdown(until, now);
    return (
        <div className="mb-3 rounded-3xl glass-card px-4 py-3 ring-1 ring-volt-500/40 dark:ring-volt-400/40">
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
            {countdown ? (
            <p className="mt-2 text-xs text-volt-700 dark:text-volt-300 font-bold uppercase tracking-wider tabular-nums">
                On the clock · {countdown}
            </p>
            ) : null}
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
        <div>
            <PaneHead title="Vote next week's coach"
                      hint={ballot.vote_count === 0
                          ? "Winner takes the megaphone Monday morning."
                          : `${ballot.vote_count} ${ballot.vote_count === 1 ? "vote" : "votes"} in`}>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-volt-700 dark:text-volt-300 tabular-nums">
                    <Timer className="h-3.5 w-3.5"/>
                    {countdown}
                </span>
            </PaneHead>
            {votable.length > 1 && (
                <div className="mb-3 flex gap-1.5 overflow-x-auto no-scrollbar">
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
            <p className="px-1 mb-3 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                {ballot.vote_count === 0
                    ? "No votes yet. You can change your pick until the switch."
                    : `Switches ${countdown === "any moment" ? "now" : "in " + countdown}. You can change your vote until then.`}
                {tiedLeaders ? " Tied coaches are drawn at random." : ""}
            </p>

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {(ballot.candidates || []).map((c) => {
                    const selected = ballot.my_vote === c.persona.id;
                    const onDuty = ballot.current_persona === c.persona.id;
                    const accent = c.persona.theme_color || "#d7ff3e";
                    return (
                        <button key={c.persona.id} type="button" onClick={() => pick(c.persona.id)}
                                disabled={isLoading}
                                className={"min-w-0 rounded-3xl glass-card p-3 text-center transition active:scale-[0.97] disabled:opacity-60 " +
                                    (selected ? "" : "hover:bg-white/5")}
                                style={selected
                                    ? {boxShadow: `0 0 0 2px ${accent}, 0 0 18px ${accent}66`}
                                    : undefined}>
                            <PersonaAvatar persona={c.persona} size={56} glow={selected || onDuty} className="mx-auto"/>
                            <p className="mt-2 text-[12px] font-bold leading-tight truncate">{c.persona.name}</p>
                            <p className="mt-0.5 text-[10px] text-gray-400">
                                {c.votes} {c.votes === 1 ? "vote" : "votes"}
                                {c.leading && c.votes > 0 ? (tiedLeaders ? " · tie" : " · lead") : ""}
                            </p>
                            {selected ? (
                                <p className="mt-1 text-[9px] font-extrabold uppercase tracking-wide"
                                   style={{color: accent}}>Your vote</p>
                            ) : onDuty ? (
                                <p className="mt-1 text-[9px] font-extrabold uppercase tracking-wide"
                                   style={{color: accent}}>On duty</p>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

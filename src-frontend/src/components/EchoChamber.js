import React, {useEffect, useState} from "react";
import {Crown, ScrollText, Share2, Swords} from "lucide-react";
import {BoxSection} from "../utils/miscellaneous";
import {SectionHead} from "./uiBits";
import {useProtectedImage} from "../utils/protectedMedia";
import {
    useChallengeEchoMutation,
    useGetEchoBookQuery,
    useGetEchoesQuery,
} from "../utils/reducers/drillInstructorSlice";
import usePollingInterval from "../utils/usePollingInterval";
import {confirmAction, notice} from "../utils/dialogs";

function formatCountdown(iso, now) {
    if (!iso) return "";
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return "any moment";
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
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

const STATUS_TONE = {
    undefeated: "bg-volt-400 text-ink-950",
    contested: "bg-amber-400 text-ink-950",
    immortal: "bg-yellow-500 text-ink-950",
    retired: "bg-white/10 text-gray-300",
};

function EchoArt({url, title}) {
    const {src} = useProtectedImage(url);
    if (!src) {
        return (
            <div className="h-40 w-full rounded-xl bg-gradient-to-br from-ink-800 via-ink-900 to-black flex items-center justify-center">
                <Crown className="h-8 w-8 text-volt-400/70"/>
            </div>
        );
    }
    return <img src={src} alt={title || ""} className="h-40 w-full object-cover rounded-xl"/>;
}

async function shareEcho(echo) {
    const text = `${echo.title} · Power ${echo.power}\n${echo.narrative}`;
    try {
        if (navigator.share) {
            await navigator.share({title: echo.title, text});
            return;
        }
        await navigator.clipboard.writeText(text);
        notice("Copied the Echo to your clipboard.");
    } catch (err) {
        if (err && err.name === "AbortError") return;
        notice("Could not share this Echo.");
    }
}

function EchoCard({echo, userId, onChallenge, busy, now}) {
    const mine = echo.holder_id === userId;
    const planted = echo.origin_id === userId;
    const war = echo.active_challenge;
    const myWar = echo.my_challenge;
    const live = echo.status === "undefeated" || echo.status === "contested";
    const canChallenge = live && !mine && !war && Boolean(userId);

    return (
        <article className="rounded-2xl border border-volt-400/35 bg-ink-900 text-white p-3.5 shadow-glow-volt">
            <EchoArt url={echo.image} title={echo.title}/>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={"rounded-full text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 " + (STATUS_TONE[echo.status] || STATUS_TONE.retired)}>
                    {echo.status === "immortal" ? "Immortal" : echo.status === "contested" ? "Under fire" : echo.status}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-volt-300">
                    Power {echo.power}
                </span>
                <span className="text-[11px] text-gray-400">{echo.metric_label}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-volt-400" style={{width: `${Math.max(8, Math.min(100, echo.power))}%`}}/>
            </div>
            <h3 className="mt-3 font-display text-sm uppercase tracking-wide leading-snug">{echo.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-300 italic">{echo.narrative}</p>
            <p className="mt-2 text-[11px] text-gray-400">
                Held by {echo.holder_name || "an athlete"}
                {planted ? " · you planted this" : echo.origin_name ? ` · planted by ${echo.origin_name}` : ""}
                {echo.chain_length > 1 ? ` · lineage ×${echo.chain_length}` : ""}
                {echo.defenses > 0 ? ` · held the line ×${echo.defenses}` : ""}
            </p>
            {war && (
                <p className="mt-2 text-xs font-semibold text-amber-300">
                    {war.challenger_name || "Someone"} is coming for it · {formatCountdown(war.window_end, now)} left
                    {myWar ? " · that's you" : ""}
                </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {canChallenge && (
                    <button type="button" disabled={busy}
                            onClick={() => onChallenge(echo)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-volt-400 text-ink-950 px-3.5 py-2 text-[11px] font-extrabold uppercase tracking-wide hover:bg-volt-300 transition disabled:opacity-50">
                        <Swords className="h-3.5 w-3.5"/> Challenge
                    </button>
                )}
                <button type="button" onClick={() => shareEcho(echo)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 text-gray-200 px-3 py-2 text-[11px] font-bold uppercase tracking-wide hover:bg-white/15 transition">
                    <Share2 className="h-3.5 w-3.5"/> Share
                </button>
            </div>
        </article>
    );
}

function EchoBook({competitionId, open}) {
    const {data: book} = useGetEchoBookQuery(competitionId, {skip: !open || !competitionId});
    if (!open) return null;
    if (!book) {
        return <p className="mt-3 text-sm text-gray-400">Opening the chronicle…</p>;
    }
    if (!book.chapters?.length) {
        return <p className="mt-3 text-sm text-gray-400">No Echoes have been planted in this challenge yet.</p>;
    }
    return (
        <ol className="mt-3 space-y-3">
            {book.chapters.map((ch) => (
                <li key={ch.id} className="rounded-xl border border-volt-400/20 bg-ink-950/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-volt-400">
                        {ch.status} · power {ch.power} · lineage ×{ch.chain_length}
                    </p>
                    <p className="mt-1 font-display text-sm uppercase">{ch.title}</p>
                    <p className="mt-1 text-sm text-gray-300 italic">{ch.narrative}</p>
                    <p className="mt-1.5 text-[11px] text-gray-500">
                        Planted by {ch.origin_name} · held by {ch.holder_name}
                    </p>
                    {(ch.wars || []).length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-[11px] text-gray-400">
                            {ch.wars.map((w, i) => (
                                <li key={`${ch.id}-${i}`}>
                                    {w.challenger} · {w.status}
                                </li>
                            ))}
                        </ul>
                    )}
                </li>
            ))}
        </ol>
    );
}

export default function EchoChamber({competitionId, userId}) {
    const poll = usePollingInterval(90000);
    const {data: echoes} = useGetEchoesQuery(
        {competition: competitionId},
        {pollingInterval: poll, skip: !competitionId},
    );
    const [challenge, {isLoading}] = useChallengeEchoMutation();
    const [bookOpen, setBookOpen] = useState(false);
    const rows = echoes || [];
    const live = rows.filter((e) => e.status === "undefeated" || e.status === "contested");
    const immortal = rows.filter((e) => e.status === "immortal");
    const ticking = live.some((e) => e.active_challenge?.window_end);
    const now = useNowTick(ticking);
    if (rows.length === 0) return null;

    async function onChallenge(echo) {
        const ok = await confirmAction(
            `Declare war on ${echo.title}? You have 7 days to beat ${echo.metric_label}. The coach will tell everyone.`,
        );
        if (!ok) return;
        try {
            await challenge(echo.id).unwrap();
        } catch (err) {
            notice(err?.data?.detail || "Could not start that challenge.");
        }
    }

    return (
        <BoxSection additionalClasses="mt-4">
            <SectionHead title="Echo Chamber" hint="Living trophies. Undefeated ones taunt the group until someone claims them.">
                <button type="button" onClick={() => setBookOpen((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 transition">
                    <ScrollText className="h-3.5 w-3.5"/>
                    {bookOpen ? "Hide book" : "Book of Echoes"}
                </button>
            </SectionHead>
            <EchoBook competitionId={competitionId} open={bookOpen}/>
            {live.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {live.map((echo) => (
                        <EchoCard key={echo.id} echo={echo} userId={userId} now={now}
                                  onChallenge={onChallenge} busy={isLoading}/>
                    ))}
                </div>
            )}
            {immortal.length > 0 && (
                <div className="mt-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-volt-500 flex items-center gap-1.5">
                        <Crown className="h-3.5 w-3.5"/> Immortal
                    </p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {immortal.map((echo) => (
                            <EchoCard key={echo.id} echo={echo} userId={userId} now={now}
                                      onChallenge={onChallenge} busy={isLoading}/>
                        ))}
                    </div>
                </div>
            )}
        </BoxSection>
    );
}

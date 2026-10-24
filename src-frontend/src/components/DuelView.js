import React, {useEffect, useState} from "react";
import ProfileAvatar from "./ProfileAvatar";
import {countdownLabel, gapLabel, pointsLabel} from "../utils/duel";
import {DayDots, PairedBars} from "./designBits";
import {isNativeApp} from "../utils/platform";
import {sharePostCard} from "../utils/shareCard";

function secondsUntil(iso, nowMs) {
    if (!iso) return 0;
    const at = new Date(iso).getTime();
    if (!Number.isFinite(at)) return 0;
    return Math.max(0, Math.floor((at - nowMs) / 1000));
}

function useClock() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const reduce = typeof window !== "undefined"
            && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        const id = setInterval(() => setNow(Date.now()), reduce ? 30000 : 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}

function ScoreRing({score, max, accent}) {
    const radius = 36;
    const length = 2 * Math.PI * radius;
    const ratio = max > 0 ? Math.max(0, Math.min(1, Number(score) / max)) : 0;
    return (
        <svg viewBox="0 0 88 88" className="h-24 w-24" aria-hidden="true">
            <circle cx="44" cy="44" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-ink-950/10 dark:text-white/15"/>
            <circle
                cx="44" cy="44" r={radius} fill="none" stroke={accent} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${length * ratio} ${length}`}
                transform="rotate(-90 44 44)"
                className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-500"
            />
        </svg>
    );
}

function Tile({person, score, max, accent, label}) {
    return (
        <article className="flex flex-col items-center p-1 text-center">
            <div className="relative">
                <ScoreRing score={score} max={max} accent={accent}/>
                <div className="absolute inset-0 flex items-center justify-center">
                    <ProfileAvatar user={person} size={52}/>
                </div>
            </div>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-muted">{label}</p>
            <p className="truncate font-display text-sm uppercase tracking-wide">{person?.username || "Athlete"}</p>
            <p className="t-stat font-display text-2xl" style={{color: label === "You" ? "var(--volt-ink)" : "var(--other)"}}>{pointsLabel(score)}</p>
        </article>
    );
}

function expiresLine(seconds) {
    const hours = Math.max(1, Math.round((Number(seconds) || 0) / 3600));
    return `expires in ${hours} h`;
}

function shareText(duel) {
    const you = duel.you?.username || "You";
    const them = duel.them?.username || "Them";
    let outcome = "It finished level.";
    if (duel.leader === "you") outcome = `@${you} finished ahead.`;
    else if (duel.leader === "them") outcome = `@${them} finished ahead.`;
    return [outcome, duel.forfeit_line].filter(Boolean).join(" ");
}

export default function DuelView({duel, busy = false, error = "", onAccept, onDecline, onCounter, onWithdraw, onMarkPaid, onConfirm, onRematch}) {
    const now = useClock();
    const [countering, setCountering] = useState(false);
    const [duration, setDuration] = useState(duel?.duration_days || 7);
    const [forfeit, setForfeit] = useState(duel?.forfeit || "");
    const [forfeitPublic, setForfeitPublic] = useState(Boolean(duel?.your_forfeit_public));
    const [feedOptIn, setFeedOptIn] = useState(Boolean(duel?.your_feed_opt_in));
    const [shareMessage, setShareMessage] = useState("");
    if (!duel) return null;

    const waiting = duel.status === "pending" || duel.status === "countered";
    const live = duel.status === "active";
    const done = duel.status === "completed";
    const replySeconds = waiting ? secondsUntil(duel.respond_by, now) : 0;
    const liveSeconds = live ? (duel.in_grace ? duel.grace_seconds_remaining : duel.seconds_remaining) : 0;
    const maxScore = Math.max(Number(duel.you?.score) || 0, Number(duel.them?.score) || 0, 1);
    const latest = Array.isArray(duel.commentary) ? duel.commentary[duel.commentary.length - 1] : null;
    const headline = done
        ? (duel.leader === "you" ? "You finished ahead" : duel.leader === "them" ? `@${duel.them?.username} finished ahead` : "It finished level")
        : live
            ? (duel.in_grace ? "Late syncs still count" : "Live")
            : waiting
                ? (duel.awaiting_you ? "Your move" : "Waiting on them")
                : duel.status === "expired"
                    ? "The invite expired"
                    : duel.status === "declined"
                        ? "They passed"
                        : duel.status === "cancelled"
                            ? "Withdrawn"
                            : duel.status;

    async function sharePostcard() {
        const title = `Duel · @${duel.you?.username || "you"} vs @${duel.them?.username || "them"}`;
        const text = shareText(duel);
        try {
            if (isNativeApp()) {
                await sharePostCard({title, text});
                setShareMessage("Postcard shared.");
                return;
            }
            if (typeof navigator.share === "function") {
                await navigator.share({title, text});
                setShareMessage("Postcard shared.");
            } else if (typeof navigator.clipboard?.writeText === "function") {
                await navigator.clipboard.writeText(`${title}\n${text}`);
                setShareMessage("Postcard summary copied.");
            } else {
                setShareMessage("Sharing is unavailable on this device.");
            }
        } catch (err) {
            if (err?.name === "AbortError") return;
            setShareMessage("The postcard could not be shared.");
        }
    }

    return (
        <section aria-label="Duel" className="space-y-4">
            <header>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">{duel.competition_name}</p>
                <h1 className="font-display text-2xl uppercase tracking-wide">{headline}</h1>
                <p className="text-sm text-muted">
                    {duel.duration_days} days · {duel.metric_label}
                    {waiting ? ` · reply in ${countdownLabel(replySeconds)}` : ""}
                    {waiting ? ` · ${expiresLine(replySeconds)}` : ""}
                    {live && !duel.in_grace ? ` · ${countdownLabel(liveSeconds)} left` : ""}
                    {live && duel.in_grace ? ` · ${countdownLabel(liveSeconds)} to sync` : ""}
                </p>
                <div className="mt-3">
                    <DayDots total={duel.duration_days} days={duel.daily}/>
                </div>
            </header>

            <div className="glass-card grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4">
                <Tile person={duel.you} score={duel.you?.score} max={maxScore} accent="#d7ff3e" label="You"/>
                <p className="t-label text-muted">vs</p>
                <Tile person={duel.them} score={duel.them?.score} max={maxScore} accent="var(--other)" label="Them"/>
            </div>

            <p className="text-center font-display text-lg uppercase tracking-wide" aria-live="polite">
                {duel.leader === "you" ? `You · ${gapLabel(Math.abs(duel.gap), "you")}` : duel.leader === "them" ? `@${duel.them?.username} · ${gapLabel(Math.abs(duel.gap), "them")}` : "Dead heat"}
            </p>

            {(live || done) && <PairedBars rows={duel.daily}/>}

            {latest?.body && (
                <blockquote className="glass-card rounded-3xl p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">{duel.coach?.name || "Coach"}</p>
                    <p className="mt-1 text-sm">{latest.body}</p>
                </blockquote>
            )}

            {duel.forfeit && (
                <p className="text-sm">
                    {done && duel.forfeit_line ? duel.forfeit_line : `Forfeit: ${duel.forfeit}`}
                </p>
            )}
            <p className="text-xs text-muted">Only the two of you see this, unless you both choose to share it.</p>

            {waiting && duel.awaiting_you && (
                <div className="space-y-3">
                    <label className="flex min-h-[44px] items-center gap-3 text-sm">
                        <input type="checkbox" checked={forfeitPublic} onChange={(event) => setForfeitPublic(event.target.checked)}/>
                        Show the forfeit if we both agree
                    </label>
                    <label className="flex min-h-[44px] items-center gap-3 text-sm">
                        <input type="checkbox" checked={feedOptIn} onChange={(event) => setFeedOptIn(event.target.checked)}/>
                        Post the result to the challenge feed if they agree too
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy} onClick={() => onAccept?.({forfeit_public: forfeitPublic, feed_opt_in: feedOptIn})} className="min-h-[44px] btn-plate px-4 text-sm font-bold">Accept</button>
                        <button type="button" disabled={busy} onClick={() => onDecline?.()} className="min-h-[44px] btn-plate-ink px-4 text-sm font-semibold">Decline</button>
                        <button type="button" disabled={busy} onClick={() => setCountering((open) => !open)} className="min-h-[44px] bg-transparent px-3 text-sm font-semibold text-muted underline">Counter</button>
                    </div>
                    {countering && (
                        <form className="space-y-3" onSubmit={(event) => {
                            event.preventDefault();
                            onCounter?.({duration_days: duration, forfeit, forfeit_public: forfeitPublic, feed_opt_in: feedOptIn});
                        }}>
                            <div className="grid grid-cols-3 gap-2">
                                {[3, 7, 14].map((days) => (
                                    <button key={days} type="button" aria-pressed={duration === days} onClick={() => setDuration(days)}
                                        className={"min-h-[44px] rounded-xl text-sm font-bold " + (duration === days ? "btn-plate" : "btn-plate-ink")}>
                                        {days} days
                                    </button>
                                ))}
                            </div>
                            <textarea value={forfeit} maxLength={200} rows={2} onChange={(event) => setForfeit(event.target.value)}
                                className="w-full rounded-xl border border-white/15 bg-white/80 px-3 py-2 text-sm dark:bg-ink-950/80" placeholder="Loser buys the beers"/>
                            <button type="submit" disabled={busy} className="min-h-[44px] btn-plate px-4 text-sm font-bold">Send the counter</button>
                        </form>
                    )}
                </div>
            )}

            {waiting && !duel.awaiting_you && (
                <button type="button" disabled={busy} onClick={() => onWithdraw?.()} className="min-h-[44px] btn-plate-ink px-4 text-sm font-semibold">Withdraw</button>
            )}

            {done && (
                <div className="glass-card rounded-3xl p-4" aria-label="Duel postcard">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Duel postcard</p>
                    <p className="mt-1 font-display text-lg uppercase tracking-wide">{headline}</p>
                    {duel.forfeit_line && <p className="mt-1 text-sm">{duel.forfeit_line}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={sharePostcard} className="min-h-[44px] btn-plate px-4 text-sm font-bold">Share postcard</button>
                        {duel.can_mark_paid && (
                            <button type="button" disabled={busy} onClick={() => onMarkPaid?.()} className="min-h-[44px] btn-plate-ink px-4 text-sm font-semibold">Mark forfeit paid</button>
                        )}
                        {duel.can_confirm_paid && (
                            <button type="button" disabled={busy} onClick={() => onConfirm?.()} className="min-h-[44px] btn-plate px-4 text-sm font-bold">Confirm forfeit paid</button>
                        )}
                        {duel.can_rematch && (
                            <button type="button" disabled={busy} onClick={() => onRematch?.()} className="min-h-[44px] btn-plate-ink px-4 text-sm font-semibold">Rematch</button>
                        )}
                    </div>
                    {duel.forfeit_marked && !duel.forfeit_confirmed && !duel.can_confirm_paid && (
                        <p className="mt-2 text-xs text-muted">Marked. Waiting on the other athlete to confirm.</p>
                    )}
                    {duel.forfeit_confirmed && <p className="mt-2 text-xs text-muted">Forfeit settled.</p>}
                    {shareMessage && <p className="mt-2 text-sm text-muted" role="status">{shareMessage}</p>}
                </div>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p>}
        </section>
    );
}

import React, {useState} from "react";
import {Link} from "react-router-dom";
import {Lock, ScrollText} from "lucide-react";
import {OverlaySheet} from "../forms/basicComponents";

const VOLT = "#d7ff3e";
const INK_600 = "#3c3c46";
const INK_700 = "#2a2a32";

export const STAMP_CATALOG = [
    {slug: "first_blood", title: "First Blood", blurb: "First scorer in a live challenge.", icon: "🩸"},
    {slug: "ghost_killer", title: "Found Your Stride", blurb: "Moved into first place through steady training.", icon: "🌱"},
    {slug: "photogenic", title: "Photogenic", blurb: "Posted a photo the coach bothered to roast.", icon: "📸"},
    {slug: "never_missed_monday", title: "Never Missed Monday", blurb: "Logged a workout on three different Mondays.", icon: "📅"},
    {slug: "survived_the_dunce", title: "Showed Up Again", blurb: "Returned to training after a quieter stretch.", icon: "💪"},
    {slug: "echo_immortal", title: "Echo Immortal", blurb: "Planted a Legend Echo that nobody could silence.", icon: "🜲"},
    {slug: "echo_slayer", title: "Echo Slayer", blurb: "Claimed someone else's Legend Echo.", icon: "⚔️"},
    {slug: "first_duel", title: "First Duel", blurb: "Stepped into a head-to-head.", icon: "🤝"},
    {slug: "duel_three_wins", title: "Three Wins", blurb: "Won three duels.", icon: "🏆"},
    {slug: "duel_revenge", title: "Revenge", blurb: "Won one back after a loss to the same athlete.", icon: "🔁"},
    {slug: "duel_streak_five", title: "Five-Duel Streak", blurb: "Won five duels in a row.", icon: "🔥"},
];

function ringGeometry(size, stroke) {
    const r = (size - stroke) / 2 - 1;
    return {r, c: 2 * Math.PI * r};
}

/** Thin progress ring. Volt marks you; everyone else stays ink. */
export function ScoreRing({value = 0, max = 1, mine = false, size = 52, children}) {
    const stroke = 2.5;
    const {r, c} = ringGeometry(size, stroke);
    const pct = max > 0 ? Math.max(0, Math.min(1, Number(value) / max)) : 0;
    const mid = size / 2;
    return (
        <span className="relative inline-flex shrink-0 items-center justify-center" style={{width: size, height: size}}>
            <svg className="absolute inset-0" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                <circle cx={mid} cy={mid} r={r} fill="none" stroke={INK_700} strokeWidth={stroke}/>
                <circle cx={mid} cy={mid} r={r} fill="none" stroke={mine ? VOLT : INK_600} strokeWidth={stroke}
                        strokeLinecap="round"
                        strokeDasharray={`${pct * c} ${c}`}
                        transform={`rotate(-90 ${mid} ${mid})`}/>
            </svg>
            <span className="relative flex items-center justify-center">{children}</span>
        </span>
    );
}

export function Segmented({value, onChange, options, label}) {
    return (
        <div role="tablist" aria-label={label}
             className="inline-flex rounded-full bg-ink-950/10 p-1 dark:bg-ink-850">
            {options.map((opt) => {
                const on = value === opt.id;
                return (
                    <button key={opt.id} type="button" role="tab" aria-selected={on}
                            onClick={() => onChange(opt.id)}
                            className={"min-h-[44px] rounded-full px-3 text-xs font-bold uppercase tracking-wide transition " +
                                (on
                                    ? "bg-white text-ink-950 shadow-sm dark:bg-ink-700 dark:text-white"
                                    : "text-muted")}>
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

export function StatTile({label, value, unit, primary = false, delta = null, className = ""}) {
    return (
        <div className={"min-w-0 rounded-[20px] bg-ink-950/5 px-3.5 py-3 dark:bg-ink-850 " + className}>
            <p className="t-caption text-muted">{label}</p>
            <p className={"mt-1 font-display text-3xl leading-none t-stat " +
                (primary ? "text-volt-600 dark:text-volt-400" : "text-ink-950 dark:text-white")}>
                {value}
                {unit ? <span className="ml-1 font-sans text-sm font-semibold text-muted">{unit}</span> : null}
            </p>
            {delta}
        </div>
    );
}

/** ▲/▼ against a personal baseline. Volt marks a gain; a drop stays muted. */
export function DeltaChip({current, average, unit, digits = 1}) {
    const now = Number(current);
    const base = Number(average);
    if (!Number.isFinite(now) || !Number.isFinite(base) || base <= 0) return null;
    const diff = now - base;
    const up = diff >= -0.05;
    const abs = Math.abs(diff);
    const shown = abs < 10 ? abs.toFixed(digits).replace(/\.0$/, "") : Math.round(abs).toLocaleString();
    return (
        <p className={"mt-1 text-xs font-bold t-stat " + (up ? "text-volt-700 dark:text-volt-400" : "text-muted")}>
            {up ? "▲" : "▼"} {shown} {unit} vs 30-day avg
        </p>
    );
}

export function MeterRing({value, max, label, display, emphasize = false, size = 92}) {
    const stroke = 7;
    const {r, c} = ringGeometry(size, stroke);
    const safeMax = Number(max) > 0 ? Number(max) : 1;
    const pct = Math.max(0, Math.min(1, (Number(value) || 0) / safeMax));
    const mid = size / 2;
    return (
        <div className="flex min-w-0 flex-col items-center gap-1.5">
            <div className="relative" style={{width: size, height: size}}
                 role="img" aria-label={`${label}: ${display}`}>
                <svg className="absolute inset-0" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                    <circle cx={mid} cy={mid} r={r} fill="none" stroke={INK_700} strokeWidth={stroke}/>
                    <circle cx={mid} cy={mid} r={r} fill="none" stroke={pct > 0 ? VOLT : INK_600}
                            strokeWidth={stroke} strokeLinecap="round"
                            strokeDasharray={`${pct * c} ${c}`}
                            transform={`rotate(-90 ${mid} ${mid})`}/>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center px-2">
                    <span className={"t-stat font-display text-xl leading-none " +
                        (emphasize ? "text-volt-600 dark:text-volt-400" : "text-ink-950 dark:text-white")}>
                        {display}
                    </span>
                </div>
            </div>
            <span className="t-caption text-muted">{label}</span>
        </div>
    );
}

export function HomePulse({minutes = 0, minuteGoal = 150, streak = 0, activeDays = 0, rank = null}) {
    const weekPct = Math.round(Math.min(100, (Number(minutes) || 0) / minuteGoal * 100));
    const rankFill = rank == null ? 0 : rank <= 1 ? 1 : Math.max(0.15, 1 / rank);
    return (
        <section className="mb-4 rounded-3xl glass-card p-4" aria-label="This week at a glance">
            <div className="flex items-start justify-around gap-2">
                <MeterRing value={minutes} max={minuteGoal} label="Week" display={`${weekPct}%`} emphasize/>
                <MeterRing value={activeDays} max={7} label="Streak" display={String(streak)}/>
                <MeterRing value={rankFill} max={1} label="Rank" display={rank == null ? "–" : `#${rank}`}/>
            </div>
        </section>
    );
}

export function HomeOrderCard({order, accent}) {
    if (!order?.brief) return null;
    return (
        <article className="mb-4 rounded-3xl glass-card border-l-2 p-4"
                 style={accent ? {borderLeftColor: accent} : undefined}>
            <p className="t-caption text-muted flex items-center gap-1.5">
                <ScrollText className="h-3.5 w-3.5" aria-hidden="true"/>
                Order of the day
                {order.competition_name ? <span className="font-semibold normal-case tracking-normal">· {order.competition_name}</span> : null}
            </p>
            <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-ink-950 dark:text-white">{order.brief}</p>
            <Link to="/coach"
                  className="mt-1 inline-flex min-h-[44px] items-center text-sm font-bold text-ink-950 underline decoration-volt-400 decoration-2 underline-offset-4 dark:text-white">
                Say more
            </Link>
        </article>
    );
}

export function StampWall({earned = []}) {
    const [open, setOpen] = useState(null);
    const bySlug = new Map((earned || []).map((tag) => [tag.slug, tag]));
    return (
        <>
            <ul className="grid grid-cols-3 gap-3">
                {STAMP_CATALOG.map((stamp) => {
                    const got = bySlug.get(stamp.slug);
                    return (
                        <li key={stamp.slug}>
                            <button type="button"
                                    onClick={() => setOpen(got || stamp)}
                                    aria-label={got ? stamp.title : `${stamp.title}, locked`}
                                    className={"flex min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-2 py-3 text-center " +
                                        (got
                                            ? "bg-ink-950/5 shadow-glow-volt ring-1 ring-volt-400/80 dark:bg-ink-850"
                                            : "border border-ink-600 text-muted")}>
                                <span className="text-2xl leading-none" aria-hidden="true">
                                    {got ? stamp.icon : <Lock className="mx-auto h-5 w-5"/>}
                                </span>
                                <span className="text-xs font-bold leading-tight">{stamp.title}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {open && (
                <OverlaySheet title={open.title || "Stamp"} onClose={() => setOpen(null)} zClass="z-[80]" labelledBy="stamp-wall-title">
                    <div className="text-center">
                        <p className="text-4xl" aria-hidden="true">{STAMP_CATALOG.find((s) => s.slug === open.slug)?.icon || "★"}</p>
                        <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            {open.blurb || "A season achievement."}
                        </p>
                        {!bySlug.get(open.slug) && (
                            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-muted">Not earned yet</p>
                        )}
                        <button type="button" onClick={() => setOpen(null)}
                                className="mt-5 inline-flex min-h-[44px] items-center btn-plate px-5 text-sm font-bold">
                            Got it
                        </button>
                    </div>
                </OverlaySheet>
            )}
        </>
    );
}

export function filterByAge(items, range, dateOf, now = Date.now()) {
    const days = range === "1m" ? 30 : range === "3m" ? 90 : null;
    if (!days) return items || [];
    const horizon = days * 86400000;
    return (items || []).filter((item) => {
        const raw = dateOf(item);
        const t = Date.parse(raw || "");
        if (!Number.isFinite(t)) return true;
        return now - t <= horizon;
    });
}

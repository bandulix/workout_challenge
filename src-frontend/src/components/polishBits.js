import React, {useState} from "react";
import {Link} from "react-router-dom";
import {Lock, ScrollText} from "lucide-react";
import {OverlaySheet} from "../forms/basicComponents";
import {BAND_LABEL, READINESS_DISCLAIMER, bandEdge} from "../utils/readinessTheme";
import {MetricRing} from "./designBits";

const RELICS = [
    {title: "First marks", slugs: ["first_blood", "ghost_killer", "photogenic"]},
    {title: "Showing up", slugs: ["never_missed_monday", "survived_the_dunce", "first_duel"]},
    {title: "Head to head", slugs: ["duel_three_wins", "duel_revenge", "duel_streak_five"]},
];

function stampIsNew(iso) {
    const at = Date.parse(iso || "");
    return Number.isFinite(at) && (Date.now() - at) < 14 * 86400000;
}

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
             className="inline-flex rounded-full p-1" style={{background: "var(--surface-2)", border: "1px solid var(--hairline)"}}>
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

export function ReadinessRing({score, band, size = 40}) {
    const stroke = 4;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const mid = size / 2;
    const pct = score == null ? 0 : Math.max(0, Math.min(1, Number(score) / 100));
    const color = bandEdge(band) || "#8a8478";
    const label = score == null ? "Readiness warming up" : `Readiness ${score}, ${BAND_LABEL[band] || band}`;
    return (
        <span className="relative shrink-0" style={{width: size, height: size}} role="img" aria-label={label}>
            <svg className="absolute inset-0" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                <circle cx={mid} cy={mid} r={r} fill="none" stroke="currentColor" className="text-ink-950/15 dark:text-white/15" strokeWidth={stroke}/>
                <circle cx={mid} cy={mid} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
                        strokeDasharray={`${pct * c} ${c}`}
                        transform={`rotate(-90 ${mid} ${mid})`}/>
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-display text-xs leading-none text-ink-950 dark:text-white">
                {score == null ? "–" : score}
            </span>
        </span>
    );
}

export function ReadinessChip({score, band, why, onOpen}) {
    const name = BAND_LABEL[band] || "Readiness";
    return (
        <button type="button" onClick={onOpen}
                className="mt-4 flex min-h-[44px] w-full items-center gap-3 rounded-2xl bg-ink-950/5 px-3 py-2 text-left dark:bg-white/5">
            <ReadinessRing score={score} band={band}/>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink-950 dark:text-white">{name}</span>
                <span className="block truncate text-xs text-muted">{why || "Tap for the morning check-in"}</span>
            </span>
        </button>
    );
}

const PILL = {green: "Primed", amber: "Steady", red: "Recover"};

export function HomePulse({minutes = 0, minuteGoal = 150, todayMinutes = null, streak = 0, activeDays = 0, rank = null, readiness = null, onOpenReadiness}) {
    const dailyGoal = Math.max(1, Math.round(minuteGoal / 7));
    const todayPct = todayMinutes == null
        ? null
        : Math.min(100, Math.round((Number(todayMinutes) || 0) / dailyGoal * 100));
    const weekPct = Math.round(Math.min(100, (Number(minutes) || 0) / minuteGoal * 100));
    const band = readiness?.band;
    const pill = PILL[band] || "Warming";
    const readyName = BAND_LABEL[band] || "Readiness";
    return (
        <section className="mb-3 glass-card p-4" aria-label="This week at a glance">
            <div className="flex items-start justify-between gap-2">
                <MetricRing
                    size="lg"
                    value={todayPct}
                    max={100}
                    display={todayPct == null ? "--%" : `${todayPct}%`}
                    label="Today"
                />
                <button type="button" onClick={onOpenReadiness} className="flex flex-col items-center"
                        aria-label={`${readyName}. ${readiness?.why || "Open the morning check-in"}`}>
                    <MetricRing
                        size="lg"
                        value={readiness?.score == null ? null : readiness.score}
                        max={100}
                        color={bandEdge(band) || "var(--hairline)"}
                        display={readiness?.score == null ? "--" : String(readiness.score)}
                        label="Readiness"
                    />
                </button>
                <MetricRing
                    size="lg"
                    value={weekPct}
                    max={100}
                    display={String(Math.round(Number(minutes) || 0))}
                    label="Week"
                    unit="min"
                />
            </div>
            <p className="mt-3 flex justify-center">
                <span className="t-label rounded-full px-3 py-1" style={{
                    color: bandEdge(band) || "var(--text-muted)",
                    border: `1px solid ${bandEdge(band) || "var(--hairline)"}`,
                }}>{pill}</span>
            </p>
            <p className="sr-only">{streak} week streak, {activeDays} active days{rank == null ? "" : `, rank ${rank}`}</p>
        </section>
    );
}

const INTENSITY = [
    {id: "red", label: "Easier"},
    {id: "amber", label: "Steady"},
    {id: "green", label: "Harder"},
];

export function HomeOrderCard({order, accent}) {
    if (!order?.brief) return null;
    const edge = bandEdge(order.band);
    const resting = order.band === "red";
    return (
        <article className="ds-volt-hero mb-3 glass-card border p-4"
                 style={{borderColor: "var(--volt)", borderLeftColor: edge || accent || "var(--volt)", borderLeftWidth: 4}}>
            <p className="t-label text-muted flex items-center gap-1.5">
                <ScrollText className="h-3.5 w-3.5" aria-hidden="true"/>
                Order of the day
                {order.competition_name ? <span className="font-semibold normal-case tracking-normal">· {order.competition_name}</span> : null}
            </p>
            {resting && <p className="t-h2 mt-2 text-ink-950 dark:text-white">Day to rest and recover</p>}
            <p className="t-body mt-2 line-clamp-3 text-ink-950 dark:text-white">{order.brief}</p>
            {resting && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {["Walk", "Mobility", "Easy spin"].map((chip) => (
                        <span key={chip} className="t-label rounded-full px-2.5 py-1 text-muted" style={{border: "1px solid var(--hairline)"}}>{chip}</span>
                    ))}
                </div>
            )}
            <div className="mt-3" role="group" aria-label="Intensity, set by this morning's readiness">
                <div className="flex gap-2">
                    {INTENSITY.map((item) => {
                        const on = order.band === item.id;
                        return (
                            <span key={item.id} aria-current={on ? "true" : undefined}
                                  className={"min-h-[44px] flex-1 rounded-full px-2 py-2 text-center text-sm font-bold " +
                                      (on ? "bg-volt-400 text-ink-950" : "text-muted")}
                                  style={on ? undefined : {border: "1px solid var(--hairline)"}}>
                                {item.label}
                            </span>
                        );
                    })}
                </div>
                <p className="t-micro mt-1 text-muted">Set by this morning's readiness.</p>
            </div>
            {order.why && <p className="mt-2 text-xs text-muted">{order.why}</p>}
            {(order.band || order.disclaimer) && (
                <p className="mt-1 text-xs text-muted">{order.disclaimer || READINESS_DISCLAIMER}</p>
            )}
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
            <ul className="mb-3 grid grid-cols-3 gap-2">
                {RELICS.map((relic) => {
                    const have = relic.slugs.filter((slug) => bySlug.has(slug)).length;
                    return (
                        <li key={relic.title} className="flex flex-col items-center rounded-[20px] px-2 py-3" style={{border: "1px solid var(--hairline)"}}>
                            <MetricRing size="sm" value={have} max={relic.slugs.length} display={`${have}/${relic.slugs.length}`} label={relic.title}/>
                        </li>
                    );
                })}
            </ul>
            <ul className="grid grid-cols-3 gap-3">
                {STAMP_CATALOG.map((stamp) => {
                    const got = bySlug.get(stamp.slug);
                    const fresh = got && stampIsNew(got.earned_at);
                    return (
                        <li key={stamp.slug}>
                            <button type="button"
                                    onClick={() => setOpen(got || stamp)}
                                    aria-label={got ? stamp.title : `${stamp.title}, locked`}
                                    className={"relative flex min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded-[20px] px-2 py-3 text-center " +
                                        (got
                                            ? "bg-ink-950/5 ring-1 ring-volt-400/80 dark:bg-ink-850" + (fresh ? " volt-flash" : "")
                                            : "text-muted opacity-40")}
                                    style={got ? undefined : {border: "1px solid var(--hairline)"}}>
                                {fresh && <span className="t-label absolute right-2 top-2 text-volt-400">New</span>}
                                {got?.count > 1 && (
                                    <span className="t-stat absolute left-2 top-2 rounded-full bg-volt-400 px-1.5 text-[11px] font-bold text-ink-950">{got.count}</span>
                                )}
                                <span className={"text-2xl leading-none " + (got ? "" : "grayscale")} aria-hidden="true">
                                    {got ? stamp.icon : <Lock className="mx-auto h-5 w-5" strokeWidth={1.75}/>}
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

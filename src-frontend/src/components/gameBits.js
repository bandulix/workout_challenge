import React, {useState} from "react";
import {Megaphone, ScrollText, Trophy} from "lucide-react";
import {BoxSection} from "../utils/miscellaneous";
import {useProtectedImage} from "../utils/protectedMedia";
import {SectionHead} from "./uiBits";
import {Modal, OverlaySheet} from "../forms/basicComponents";

const HALL_PREVIEW = 3;

export const TAG_ICON = {
    first_blood: "🩸",
    ghost_killer: "👻",
    photogenic: "📸",
    never_missed_monday: "📅",
    survived_the_dunce: "📣",
    echo_immortal: "🜲",
    echo_slayer: "⚔️",
};

export const MOOD_CHIP = {
    unleashed: "bg-volt-400 text-ink-950 shadow-glow-volt",
    proud: "bg-volt-400/25 text-volt-800 dark:text-volt-200",
    watching: "bg-amber-400/25 text-amber-800 dark:text-amber-200",
    disappointed: "bg-red-500/15 text-red-700 dark:text-red-300",
};

// Orbit motion follows coach mood. No mood (no config yet) uses a
// single calm spin so the portrait still lives.
const MOOD_ORBIT = {
    unleashed: {ring: "animate-squad-orbit-fast", wave: false, tilt: false},
    proud: {ring: "animate-squad-orbit", wave: false, tilt: false},
    watching: {ring: "animate-squad-orbit-swing", wave: false, tilt: false},
    disappointed: {ring: "animate-squad-orbit-slow", wave: true, tilt: false},
};
const DEFAULT_ORBIT = {ring: "animate-squad-orbit-slow", wave: false, tilt: false};

export function trainedSummary(mood) {
    if (!mood) return null;
    const total = Math.max(Number(mood.participants) || 0, 1);
    const use24 = mood.active_24h != null;
    const active = Math.max(0, Math.min(Number(use24 ? mood.active_24h : mood.active_48h) || 0, total));
    const window = use24 ? "the last 24 hours" : "the last 48 hours";
    return {
        active,
        total,
        label: `${active} of ${total} trained`,
        hint: `${active} of ${total} ${total === 1 ? "athlete" : "athletes"} trained in ${window}`,
    };
}

const RING_SEGMENTS_MAX = 24;
const PIP_MAX = 12;
const RING_CX = 50;
const RING_CY = 50;
const RING_R = 48.2;
const VOLT = "#d7ff3e";

function accentHex(color) {
    const raw = String(color || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
        return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
    }
    return VOLT;
}

function accentRgba(color, alpha) {
    const hex = accentHex(color).slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(startDeg, endDeg) {
    const [sx, sy] = polar(RING_CX, RING_CY, RING_R, startDeg);
    const [ex, ey] = polar(RING_CX, RING_CY, RING_R, endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${RING_R} ${RING_R} 0 ${large} 1 ${ex} ${ey}`;
}

// 24h activity ticks sit ON the neon photo border. The border itself is
// a CSS accent ring on the portrait; this SVG only lights trained segments.
function ActivityTicks({total, filled, color}) {
    const n = Math.max(1, Math.min(total, RING_SEGMENTS_MAX));
    const lit = Math.max(0, Math.min(filled, n));
    if (lit <= 0) return null;
    const full = lit >= n;
    const stroke = full ? 5.4 : 4.2;
    const accent = accentHex(color);

    const ticks = [];
    if (n === 1) {
        ticks.push(
            <circle key="one" cx={RING_CX} cy={RING_CY} r={RING_R} fill="none"
                    stroke={accent} strokeWidth={stroke}/>
        );
    } else {
        const gap = Math.min(7, 48 / n);
        const step = 360 / n;
        const sweep = Math.max(step - gap, 5);
        for (let i = 0; i < lit; i += 1) {
            const start = -90 + i * step + gap / 2;
            ticks.push(
                <path key={i} d={arcPath(start, start + sweep)} fill="none"
                      stroke={accent} strokeWidth={stroke} strokeLinecap="round"/>
            );
        }
    }

    return (
        <svg viewBox="0 0 100 100"
             className={"pointer-events-none absolute -inset-[5px] h-[calc(100%+10px)] w-[calc(100%+10px)] " +
                 (full ? "activity-ring-full" : "")}
             aria-hidden="true">
            {ticks}
        </svg>
    );
}

export function SquadOrbit({mood, children, showCaption = true, accent}) {
    const trained = trainedSummary(mood) || {active: 0, total: 8, hint: "Coach orbit"};
    const total = trained.total;
    const active = trained.active;
    const ringCount = Math.max(1, Math.min(total, RING_SEGMENTS_MAX));
    const ringLit = Math.round((active / Math.max(total, 1)) * ringCount);
    const pipCount = Math.max(8, Math.min(Math.max(total, 8), PIP_MAX));
    const pipLit = Math.round((active / Math.max(total, 1)) * pipCount);
    const motion = MOOD_ORBIT[mood?.key] || DEFAULT_ORBIT;
    const ratio = active / Math.max(total, 1);
    const full = ringLit >= ringCount && ringCount > 0;
    const sparse = ringLit <= 1 && ringCount > 1;
    const color = accentHex(accent);
    const countTone = ratio > 0 ? "text-ink-950 dark:text-white" : "text-gray-400";
    const pips = [];
    for (let i = 0; i < pipCount; i += 1) {
        const deg = (360 / pipCount) * i - 90;
        const isLit = i < pipLit;
        pips.push(
            <span key={i} aria-hidden="true"
                  className="absolute left-1/2 top-1/2"
                  style={{transform: `rotate(${deg}deg) translateY(calc(-1 * var(--orbit)))`}}>
                <span className={"block rounded-full " +
                    (isLit
                        ? "h-2.5 w-2.5 " + (motion.wave ? "animate-squad-pip-wave" : "animate-squad-hop")
                        : "h-2 w-2 bg-gray-300 dark:bg-ink-600 " + (motion.wave ? "animate-squad-pip-wave" : ""))}
                      style={{
                          ...(isLit ? {backgroundColor: color, boxShadow: `0 0 10px ${accentRgba(color, 0.75)}`} : {}),
                          ...((isLit || motion.wave) ? {animationDelay: `${i * (motion.wave ? 0.18 : 0.14)}s`} : {}),
                      }}/>
            </span>
        );
    }
    const ring = (
        <div className={"relative h-[8.5rem] w-[8.5rem] [--orbit:3.45rem] sm:h-[9.6rem] sm:w-[9.6rem] sm:[--orbit:3.9rem] " +
            (motion.tilt ? "[perspective:520px]" : "")}
             style={{
                 "--coach-accent": color,
                 "--coach-accent-glow": accentRgba(color, 0.5),
                 "--coach-accent-glow-strong": accentRgba(color, 0.95),
             }}
             title={trained.hint}
             aria-label={trained.hint}>
            <div className={"absolute inset-0 " + (motion.tilt ? "[transform-style:preserve-3d] " : "") + motion.ring}
                 aria-hidden="true">
                {pips}
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
                <div className={"relative h-[5.5rem] w-[5.5rem] sm:h-[6.25rem] sm:w-[6.25rem] rounded-full animate-float-slow coach-pic-ring " +
                    (full ? "coach-pic-ring-full" : sparse ? "coach-pic-ring-sparse" : "")}>
                    <ActivityTicks total={ringCount} filled={ringLit} color={color}/>
                    <div className="absolute inset-0 overflow-hidden rounded-full">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
    if (!showCaption) return <div className="shrink-0">{ring}</div>;
    return (
        <div className="flex flex-col items-center shrink-0">
            {ring}
            <div className="mt-1.5 text-center leading-tight" aria-hidden="true">
                <p className={"font-display text-[0.95rem] tabular-nums tracking-wide " + countTone}>
                    {active}<span className="text-[0.7rem] font-sans font-bold text-gray-400"> of {total}</span>
                </p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                    trained last 24h
                </p>
            </div>
        </div>
    );
}

export function OrderCard({order}) {
    if (!order) return null;
    return (
        <BoxSection>
            <SectionHead title="Order of the day" hint={order.competition_name}/>
            <div className="mt-3 rounded-2xl glass-inset border-volt-500/50 dark:border-volt-400/40 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-volt-700 dark:text-volt-400 flex items-center gap-1.5">
                    <ScrollText className="h-3.5 w-3.5"/> Sealed order · {order.date}
                </p>
                <p className="mt-2 text-[15px] leading-relaxed">{order.brief}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {order.completed ? (
                        <span className="rounded-full bg-volt-400 text-ink-950 text-[10px] font-extrabold uppercase tracking-wide px-2.5 py-1">
                            You completed it
                        </span>
                    ) : (
                        <span className="rounded-full bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-gray-300 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1">
                            Still open
                        </span>
                    )}
                    {order.completers?.length > 0 && (
                        <span className="text-[11px] text-gray-600 dark:text-gray-400">
                            {order.completers.map((c) => c.first_name).join(", ")}
                        </span>
                    )}
                </div>
            </div>
        </BoxSection>
    );
}

function HallFrame({card, place, onOpen, compact = false}) {
    const {src} = useProtectedImage(card.image);
    return (
        <div className="min-w-0 flex-1">
            <button type="button" onClick={() => src && onOpen(src)}
                    className="block w-full text-left">
                <div className="relative rounded-xl p-1 bg-gradient-to-br from-yellow-500 via-amber-200 to-yellow-700 shadow-card">
                    {src ? (
                        <img src={src} alt="" className={(compact ? "h-28" : "h-36") + " w-full object-cover rounded-lg"}/>
                    ) : (
                        <div className={(compact ? "h-28" : "h-36") + " rounded-lg bg-gray-200 dark:bg-ink-900"}/>
                    )}
                    <span className="absolute top-2 left-2 rounded-full bg-ink-950/80 text-volt-400 text-[10px] font-extrabold px-2 py-0.5">
                        #{place}
                    </span>
                </div>
            </button>
            <p className="mt-1.5 text-xs text-gray-500 truncate">
                {card.hot_votes || 0} hot
                {card.athlete_name ? ` · ${card.athlete_name}` : ""}
            </p>
        </div>
    );
}

export function HallOfRoasts({cards}) {
    const [fullSrc, setFullSrc] = useState(null);
    const [showAll, setShowAll] = useState(false);
    const list = cards || [];
    const preview = list.slice(0, HALL_PREVIEW);
    const older = Math.max(0, list.length - HALL_PREVIEW);

    if (list.length === 0) {
        return (
            <BoxSection>
                <SectionHead title="Hall of roasts" hint="Hottest remixed photos"/>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                    Empty for now. Post a photo under a workout — the coach remixes it, and the hottest shots land here.
                </p>
            </BoxSection>
        );
    }
    return (
        <BoxSection>
            <SectionHead title="Hall of roasts"
                         hint={list.length > HALL_PREVIEW ? `Top ${HALL_PREVIEW} of ${list.length}` : "Hottest remixed photos"}/>
            <div className="mt-3 flex gap-3">
                {preview.map((c, i) => (
                    <HallFrame key={c.id} card={c} place={i + 1} onOpen={setFullSrc}/>
                ))}
            </div>
            {older > 0 && (
                <button type="button" onClick={() => setShowAll(true)}
                        className="mt-3 w-full min-h-[44px] rounded-2xl border border-volt-400/40 text-sm font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300 hover:bg-volt-400/10 transition">
                    {older} more {older === 1 ? "roast" : "roasts"}
                </button>
            )}
            {showAll && (
                <Modal title="Hall of roasts" setShowModal={setShowAll}>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {list.map((c, i) => (
                            <HallFrame key={c.id} card={c} place={i + 1} onOpen={setFullSrc} compact/>
                        ))}
                    </div>
                </Modal>
            )}
            {fullSrc && (
                <OverlaySheet title="Roast" onClose={() => setFullSrc(null)} zClass="z-[70]">
                    <img src={fullSrc} alt=""
                         className="mx-auto max-h-[70vh] w-full rounded-2xl object-contain"/>
                </OverlaySheet>
            )}
        </BoxSection>
    );
}

export function DogTagRow({tags}) {
    const [open, setOpen] = useState(null);
    if (!tags || tags.length === 0) return null;
    return (
        <>
            <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((t) => (
                    <button key={t.slug} type="button" onClick={() => setOpen(t)}
                            className="inline-flex items-center gap-1 rounded-full border border-volt-700/40 bg-volt-400/25 text-volt-800 dark:border-ink-700/40 dark:bg-ink-900 dark:text-volt-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide min-h-[28px] hover:border-volt-500 hover:bg-volt-400/40 dark:hover:border-volt-400/70 dark:hover:bg-ink-800 transition">
                        <span aria-hidden="true">{TAG_ICON[t.slug] || "★"}</span>
                        {t.title}
                    </button>
                ))}
            </div>
            {open && (
                <OverlaySheet title={open.title} onClose={() => setOpen(null)} zClass="z-[80]" labelledBy="dog-tag-title">
                    <div className="text-center">
                        <p className="text-4xl" aria-hidden="true">{TAG_ICON[open.slug] || "★"}</p>
                        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                            {open.blurb || "A season achievement."}
                        </p>
                        <button type="button" onClick={() => setOpen(null)}
                                className="mt-5 inline-flex min-h-[44px] items-center rounded-full bg-volt-400 text-ink-950 px-5 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition">
                            Got it
                        </button>
                    </div>
                </OverlaySheet>
            )}
        </>
    );
}

export function DunceBadge({show, size = 18}) {
    if (!show) return null;
    return (
        <span title="Dunce megaphone — last on the board until they log"
              className="absolute -top-1 -left-1 z-10 h-6 w-6 rounded-full bg-ink-950 border border-volt-400 text-volt-400 flex items-center justify-center shadow-glow-volt"
              style={{width: size, height: size}}>
            <Megaphone className="h-3 w-3"/>
        </span>
    );
}

export function OrderRibbon({show}) {
    if (!show) return null;
    return (
        <span className="shrink-0 rounded-full bg-volt-400 text-ink-950 text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 inline-flex items-center gap-1">
            <Trophy className="h-3 w-3"/> Order <span className="tabular-nums">+5P</span>
        </span>
    );
}

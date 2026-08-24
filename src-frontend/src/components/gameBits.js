import React, {useState} from "react";
import {Megaphone, ScrollText, Trophy} from "lucide-react";
import {BoxSection} from "../utils/miscellaneous";
import {useProtectedImage} from "../utils/protectedMedia";
import ProfileAvatar from "./ProfileAvatar";
import {SectionHead} from "./uiBits";
import {Modal} from "../forms/basicComponents";

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

const SQUAD_PIPS_MAX = 12;

export function SquadOrbit({mood, children}) {
    if (!mood) return children;
    const total = Math.max(Number(mood.participants) || 0, 1);
    const active = Math.max(0, Math.min(Number(mood.active_48h) || 0, total));
    const shown = Math.min(total, SQUAD_PIPS_MAX);
    const lit = Math.round((active / total) * shown);
    const intensity = Number(mood.intensity) || 0;
    const orbitClass = ["animate-squad-orbit-slow", "animate-squad-orbit", "animate-squad-orbit-fast", "animate-squad-orbit-fast"][intensity]
        || "animate-squad-orbit";
    const ratio = active / total;
    const countTone = ratio >= 0.8
        ? "text-volt-700 dark:text-volt-300"
        : ratio > 0
            ? "text-ink-950 dark:text-white"
            : "text-gray-400";
    const pips = [];
    for (let i = 0; i < shown; i += 1) {
        const deg = (360 / shown) * i - 90;
        const trained = i < lit;
        pips.push(
            <span key={i} aria-hidden="true"
                  className="absolute left-1/2 top-1/2"
                  style={{transform: `rotate(${deg}deg) translateY(calc(-1 * var(--orbit)))`}}>
                <span className={"block rounded-full " +
                    (trained
                        ? "h-2.5 w-2.5 bg-volt-400 shadow-glow-volt animate-squad-hop"
                        : "h-2 w-2 bg-gray-300 dark:bg-ink-600")}
                      style={trained ? {animationDelay: `${i * 0.14}s`} : undefined}/>
            </span>
        );
    }
    const summary = `${active} of ${total} ${total === 1 ? "athlete" : "athletes"} trained in the last 48 hours`;
    return (
        <div className="flex flex-col items-center shrink-0">
            <div className="relative h-[7.5rem] w-[7.5rem] [--orbit:2.7rem] sm:h-[8.6rem] sm:w-[8.6rem] sm:[--orbit:3.15rem]"
                 title={summary}
                 aria-label={summary}>
                <div className={"absolute inset-0 " + orbitClass} aria-hidden="true">
                    {pips}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                    {children}
                </div>
            </div>
            <div className="mt-1.5 text-center leading-tight" aria-hidden="true">
                <p className={"font-display text-[0.95rem] tabular-nums tracking-wide " + countTone}>
                    {active}<span className="text-[0.7rem] font-sans font-bold text-gray-400"> of {total}</span>
                </p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                    trained last 48h
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
                <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
                     onClick={() => setFullSrc(null)} role="dialog" aria-modal="true">
                    <img src={fullSrc} alt=""
                         className="max-h-[90vh] max-w-full rounded-2xl shadow-2xl object-contain"
                         onClick={(e) => e.stopPropagation()}/>
                </div>
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
                <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                     onClick={() => setOpen(null)} role="dialog" aria-modal="true" aria-labelledby="dog-tag-title">
                    <div className="w-full max-w-sm rounded-3xl glass-card p-6 text-center"
                         onClick={(e) => e.stopPropagation()}>
                        <p className="text-4xl" aria-hidden="true">{TAG_ICON[open.slug] || "★"}</p>
                        <h2 id="dog-tag-title" className="mt-3 font-display text-lg uppercase tracking-wide">{open.title}</h2>
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                            {open.blurb || "A season achievement."}
                        </p>
                        <button type="button" onClick={() => setOpen(null)}
                                className="mt-5 inline-flex min-h-[44px] items-center rounded-full bg-volt-400 text-ink-950 px-5 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition">
                            Got it
                        </button>
                    </div>
                </div>
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
            <Trophy className="h-3 w-3"/> Order
        </span>
    );
}

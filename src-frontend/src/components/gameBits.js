import React, {useEffect, useRef, useState} from "react";
import {ChevronLeft, ChevronRight, Megaphone, ScrollText, Share2, Trophy, X, Zap} from "lucide-react";
import {useProtectedImage} from "../utils/protectedMedia";
import {EmptyState, PaneHead, paneCardClass} from "./uiBits";
import {OverlaySheet} from "../forms/basicComponents";
import {sharePostCard} from "../utils/shareCard";
import {playSfx} from "../utils/sfx";
import {OverlayPortal, useBodyScrollLock} from "../utils/overlay";
import {ActivityReactProvider, ActivityStampButton, ActivityStampIcons} from "./ActivityReacts";

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
    unleashed: {ring: "animate-squad-orbit-fast", wave: false},
    proud: {ring: "animate-squad-orbit", wave: false},
    watching: {ring: "animate-squad-orbit-swing", wave: false},
    disappointed: {ring: "animate-squad-orbit-slow", wave: true},
};
const DEFAULT_ORBIT = {ring: "animate-squad-orbit-slow", wave: false};

export function trainedSummary(mood) {
    if (!mood) return null;
    const total = Math.max(Number(mood.participants) || 0, 1);
    const raw = mood.active_today ?? mood.active_24h ?? mood.active_48h;
    const active = Math.max(0, Math.min(Number(raw) || 0, total));
    return {
        active,
        total,
        label: `${active} of ${total} trained`,
        hint: `${active} of ${total} ${total === 1 ? "athlete" : "athletes"} trained today`,
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

// Today's activity ticks sit ON the neon photo border. The border itself is
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
    const primedFull = useRef(false);
    const wasFull = useRef(false);
    useEffect(() => {
        if (!mood) return;
        const isFull = total > 0 && active >= total;
        if (!primedFull.current) {
            primedFull.current = true;
            wasFull.current = isFull;
            return;
        }
        if (isFull && !wasFull.current) playSfx("ring_full");
        wasFull.current = isFull;
    }, [mood, active, total]);
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
        <div className="relative h-[8.5rem] w-[8.5rem] [--orbit:3.45rem] sm:h-[9.6rem] sm:w-[9.6rem] sm:[--orbit:3.9rem]"
             style={{
                 "--coach-accent": color,
                 "--coach-accent-glow": accentRgba(color, 0.5),
                 "--coach-accent-glow-strong": accentRgba(color, 0.95),
             }}
             title={trained.hint}
             aria-label={trained.hint}>
            <div className={"absolute inset-0 " + motion.ring}
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
                    trained today
                </p>
            </div>
        </div>
    );
}

export function OrderCard({order}) {
    if (!order) return null;
    return (
        <div>
            <PaneHead title="Order of the day" hint={order.competition_name}/>
            <article className={paneCardClass}>
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
            </article>
        </div>
    );
}

// Fullscreen roast viewer: the photo fills the screen, pinch and
// double-tap zoom it (pan while zoomed), a swipe navigates in fit mode,
// swipe-down closes. Share/stamp float as overlays on the image.
function RoastGallery({cards, index, onClose, onIndex}) {
    const card = cards[index];
    const {src} = useProtectedImage(card?.image);
    const stageRef = useRef(null);
    const pointers = useRef(new Map());
    const gesture = useRef(null);
    const lastTap = useRef(0);
    const [zoom, setZoom] = useState({scale: 1, x: 0, y: 0, anim: false});
    useBodyScrollLock();

    useEffect(() => {
        function onKey(e) {
            if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
            if (e.key === "ArrowRight") onIndex(Math.min(cards.length - 1, index + 1));
            if (e.key === "Escape") onClose();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [index, cards.length, onClose, onIndex]);

    // A new photo always opens in fit mode.
    useEffect(() => { setZoom({scale: 1, x: 0, y: 0, anim: false}); }, [index]);

    if (!card) return null;
    const caption = card.body || `${card.persona_name || "Coach"} roasting ${card.athlete_name || "an athlete"}`;
    const threadMsg = card.thread_id
        ? {id: card.thread_id, reacts: card.thread_reacts || []}
        : null;

    function clampPan(s, x, y) {
        const el = stageRef.current;
        if (!el) return {x, y};
        const r = el.getBoundingClientRect();
        return {
            x: Math.min((s - 1) * r.width / 2, Math.max(-(s - 1) * r.width / 2, x)),
            y: Math.min((s - 1) * r.height / 2, Math.max(-(s - 1) * r.height / 2, y)),
        };
    }

    function onPointerDown(e) {
        stageRef.current?.setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
        const now = performance.now();
        if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            gesture.current = {
                mode: "pinch",
                dist: Math.hypot(a.x - b.x, a.y - b.y),
                scale: zoom.scale, x: zoom.x, y: zoom.y,
            };
            return;
        }
        if (pointers.current.size !== 1) return;
        if (now - lastTap.current < 300) {
            // Double-tap: toggle fit <-> 2.5x, zooming toward the tap.
            lastTap.current = 0;
            const r = stageRef.current.getBoundingClientRect();
            const s = zoom.scale > 1 ? 1 : 2.5;
            const c = s > 1
                ? clampPan(s, (r.left + r.width / 2 - e.clientX) * (s - 1),
                           (r.top + r.height / 2 - e.clientY) * (s - 1))
                : {x: 0, y: 0};
            setZoom({scale: s, ...c, anim: true});
            gesture.current = null;
            return;
        }
        lastTap.current = now;
        gesture.current = {mode: "single", sx: e.clientX, sy: e.clientY,
                           x: zoom.x, y: zoom.y, moved: false};
    }

    function onPointerMove(e) {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
        const g = gesture.current;
        if (!g) return;
        if (g.mode === "pinch" && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const s = Math.min(4, Math.max(1, g.scale * (dist / Math.max(1, g.dist))));
            setZoom({scale: s, ...clampPan(s, g.x * (s / g.scale), g.y * (s / g.scale)), anim: false});
        } else if (g.mode === "single") {
            const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
            if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
            if (zoom.scale > 1) {
                setZoom({scale: zoom.scale, ...clampPan(zoom.scale, g.x + dx, g.y + dy), anim: false});
            }
        }
    }

    function onPointerUp(e) {
        pointers.current.delete(e.pointerId);
        const g = gesture.current;
        gesture.current = null;
        if (!g) return;
        if (g.mode === "pinch" && zoom.scale <= 1.05) {
            setZoom({scale: 1, x: 0, y: 0, anim: true});  // pinch-out snaps to fit
            return;
        }
        if (g.mode === "single" && g.moved && zoom.scale === 1) {
            const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
            if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) { onClose(); return; }
            if (dx > 60) onIndex(Math.max(0, index - 1));
            else if (dx < -60) onIndex(Math.min(cards.length - 1, index + 1));
        }
    }

    const chip =
        "pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur " +
        "border border-white/20 text-white min-h-[44px] px-3 text-[11px] font-bold uppercase tracking-wide";

    return (
        <OverlayPortal>
            <div role="dialog" aria-modal="true" aria-label={card.athlete_name || "Roast"}
                 className="fixed inset-0 z-[80] bg-black select-none"
                 style={{touchAction: "none"}}>
                {/* the photo stage eats every gesture */}
                <div ref={stageRef}
                     className="absolute inset-0 overflow-hidden flex items-center justify-center"
                     onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                     onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                    <img src={src} alt={caption} draggable={false}
                         className={"max-h-full max-w-full object-contain " +
                             (zoom.anim ? "transition-transform duration-200" : "")}
                         style={{transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`}}/>
                </div>

                {/* top bar */}
                <div className="absolute top-0 inset-x-0 flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,var(--safe-top))] pointer-events-none">
                    <span className={chip}>{card.athlete_name || "Roast"}</span>
                    <button type="button" onClick={onClose} aria-label="Close" className={chip + " !px-0 min-w-[44px] justify-center"}>
                        <X className="h-5 w-5"/>
                    </button>
                </div>

                {/* edge nav, fit mode only (zoomed = pan, not navigate) */}
                {zoom.scale === 1 && (<>
                    {index > 0 && (
                        <button type="button" onClick={() => onIndex(index - 1)} aria-label="Previous roast"
                                className={"absolute left-2 top-1/2 -translate-y-1/2 !px-0 min-w-[44px] justify-center " + chip}>
                            <ChevronLeft className="h-5 w-5"/>
                        </button>
                    )}
                    {index < cards.length - 1 && (
                        <button type="button" onClick={() => onIndex(index + 1)} aria-label="Next roast"
                                className={"absolute right-2 top-1/2 -translate-y-1/2 !px-0 min-w-[44px] justify-center " + chip}>
                            <ChevronRight className="h-5 w-5"/>
                        </button>
                    )}
                </>)}

                {/* bottom overlay: caption + stamps + share */}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent
                                px-4 pt-10 pb-[max(1rem,var(--safe-bottom))] pointer-events-none">
                    <p className="text-sm leading-relaxed break-words text-white/95">{caption}</p>
                    <p className="mt-1 text-[11px] text-white/60">
                        {[card.persona_name, card.competition_name].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2 pointer-events-auto text-white">
                        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                            {threadMsg ? (
                                <ActivityReactProvider message={threadMsg}>
                                    <ActivityStampIcons/>
                                    <ActivityStampButton/>
                                </ActivityReactProvider>
                            ) : (
                                <ReactCount count={card.react_count}/>
                            )}
                        </div>
                        <span className="text-[11px] text-white/80 shrink-0">{index + 1} / {cards.length}</span>
                        <button type="button" onClick={() => sharePostCard({
                            title: card.athlete_name || "Roast",
                            text: caption,
                            imageUrl: card.image,
                        })} className={chip}>
                            <Share2 className="h-3.5 w-3.5"/> Share
                        </button>
                    </div>
                </div>
            </div>
        </OverlayPortal>
    );
}

// Badge on hall tiles / the gallery: how many emoji reactions the
// roast's thread collected - the group's verdict on the best shots.
function ReactCount({count, light = false}) {
    const n = Math.max(0, Number(count) || 0);
    const filled = n > 0;
    return (
        <span className={"inline-flex items-center gap-1 tabular-nums " +
            (light ? "text-white" : "text-volt-700 dark:text-volt-300")}>
            <Zap className={"h-3.5 w-3.5 " + (filled
                ? "fill-volt-400 text-volt-500"
                : (light ? "text-white/70" : "text-gray-400"))}
                 aria-hidden="true"/>
            <span className="text-[10px] font-extrabold">{n}</span>
            <span className="sr-only">{n === 1 ? "1 reaction" : `${n} reactions`}</span>
        </span>
    );
}

function sortHallCards(cards) {
    return [...(cards || [])].sort((a, b) => {
        const bt = Date.parse(b.posted_at || "") || 0;
        const at = Date.parse(a.posted_at || "") || 0;
        return bt - at;
    });
}

function HallFrame({card, onOpen}) {
    const {src} = useProtectedImage(card.image, "card");
    const reacts = card.react_count || 0;
    return (
        <article className="min-w-0 rounded-3xl glass-card text-ink-950 dark:text-white">
            <button type="button" onClick={() => src && onOpen()}
                    className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-volt-400">
                <div className="relative overflow-hidden rounded-t-3xl">
                    {src ? (
                        <img src={src} alt="" className="h-36 w-full object-cover"/>
                    ) : (
                        <div className="h-36 bg-ink-950/40 dark:bg-ink-900 flex items-center justify-center">
                            <Trophy className="h-7 w-7 text-volt-400/50"/>
                        </div>
                    )}
                    <span className="absolute bottom-2 right-2 inline-flex rounded-full bg-ink-950/75 px-2 py-0.5 backdrop-blur-sm">
                        <ReactCount count={reacts} light/>
                    </span>
                </div>
                <div className="px-2.5 py-2">
                    <p className="text-[12px] font-bold truncate">{card.athlete_name || "Athlete"}</p>
                </div>
            </button>
        </article>
    );
}

// The hall shows six cards at a glance: the three newest remixes on top,
// then the three most reacted-to shots of the season (deduplicated - a
// brand-new banger isn't shown twice). "Show all" flattens to the full
// newest-first grid.
export function hallShowcase(cards) {
    const list = sortHallCards(cards);
    const newest = list.slice(0, 3);
    const newestIds = new Set(newest.map((c) => c.id));
    const topReacted = [...list]
        .sort((a, b) =>
            ((b.react_count || 0) - (a.react_count || 0))
            || ((Date.parse(b.posted_at || "") || 0) - (Date.parse(a.posted_at || "") || 0)))
        .filter((c) => !newestIds.has(c.id))
        .slice(0, 3);
    return {list, newest, topReacted};
}

export function HallOfRoasts({cards, persona}) {
    const [openIndex, setOpenIndex] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const {list, newest, topReacted} = hallShowcase(cards);
    const many = list.length > newest.length + topReacted.length;

    if (list.length === 0) {
        return (
            <div>
                <PaneHead title="Hall of roasts" hint="Newest remixed photos"/>
                <article className={paneCardClass}>
                    <EmptyState persona={persona} title="Empty for now"
                                body="Post a photo under a workout — the coach remixes it, and the shots land here."/>
                </article>
            </div>
        );
    }

    const frame = (c) => (
        <HallFrame key={c.id} card={c} onOpen={() => setOpenIndex(list.indexOf(c))}/>
    );

    return (
        <div>
            <PaneHead title="Hall of roasts" hint="Newest + most reacted remixes"/>
            {expanded ? (
                <div className="grid grid-cols-3 gap-3">{list.map(frame)}</div>
            ) : (
                <div className="space-y-3">
                    <div>
                        <p className="px-1 mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Fresh off the roast</p>
                        <div className="grid grid-cols-3 gap-3">{newest.map(frame)}</div>
                    </div>
                    {topReacted.length > 0 && (
                        <div>
                            <p className="px-1 mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Crowd favourites</p>
                            <div className="grid grid-cols-3 gap-3">{topReacted.map(frame)}</div>
                        </div>
                    )}
                </div>
            )}
            {many ? (
                <button type="button" onClick={() => setExpanded((v) => !v)}
                        className="mt-2 w-full min-h-[40px] rounded-2xl text-sm font-semibold text-volt-700 dark:text-volt-300 hover:bg-volt-400/10 transition">
                    {expanded ? "Show less" : `Show all ${list.length}`}
                </button>
            ) : null}
            {openIndex != null && list[openIndex] && (
                <RoastGallery cards={list} index={openIndex} onIndex={setOpenIndex}
                              onClose={() => setOpenIndex(null)}/>
            )}
        </div>
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

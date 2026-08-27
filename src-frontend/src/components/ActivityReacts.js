import React, {createContext, useContext, useEffect, useMemo, useRef, useState} from "react";
import {Plus} from "lucide-react";
import {useReactToActivityMutation} from "../utils/reducers/drillInstructorSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import ProfileAvatar from "./ProfileAvatar";
import StampGlyph from "./stampGlyphs";
import {OverlayPortal} from "../utils/overlay";
import {useProtectedImage} from "../utils/protectedMedia";

// Workout stamps. Ids must match ACTIVITY_REACT_EMOJIS.
export const ACTIVITY_REACTS = [
    {id: "fire", label: "Lit", glow: "#ff6a3d"},
    {id: "beast", label: "Swole", glow: "#d7ff3e"},
    {id: "volt", label: "Zap", glow: "#e8ff73"},
    {id: "goat", label: "GOAT", glow: "#ffd60a"},
    {id: "podium", label: "W", glow: "#f4c430"},
    {id: "rocket", label: "Send it", glow: "#3cffff"},
    {id: "ice", label: "Too cool", glow: "#7ad7ff"},
    {id: "how", label: "WTF!", glow: "#c77dff"},
    {id: "menace", label: "Feral", glow: "#ff3cac"},
    {id: "dead", label: "RIP", glow: "#e8e8ee"},
    {id: "melted", label: "Cooked", glow: "#ff9f43"},
    {id: "heavy", label: "Oof", glow: "#9bb0ff"},
    {id: "salute", label: "Respect", glow: "#5eead4"},
    {id: "love", label: "Heart", glow: "#ff6b9d"},
];

const BY_ID = Object.fromEntries(ACTIVITY_REACTS.map((r) => [r.id, r]));

const STAMP_BTN =
    "inline-flex items-center gap-1.5 rounded-full btn-glass px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-volt-700 dark:hover:text-volt-300 transition min-h-[32px]";

function finePointer() {
    return typeof window !== "undefined"
        && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function toggleLocal(reacts, emoji, me) {
    const mine = {id: me.id, name: me.name, picture: me.picture};
    const turningOff = (reacts || []).some((row) => row.emoji === emoji && row.me);
    const next = [];
    for (const row of reacts || []) {
        const people = (row.people || []).filter((p) => p.id !== me.id);
        if (row.emoji === emoji) {
            if (turningOff) {
                if (people.length) next.push({emoji: row.emoji, people, count: people.length, me: false});
            } else {
                next.push({emoji: row.emoji, people: [...people, mine], count: people.length + 1, me: true});
            }
        } else if (people.length) {
            next.push({emoji: row.emoji, people, count: people.length, me: false});
        }
    }
    if (!turningOff && !next.some((row) => row.emoji === emoji)) {
        next.push({emoji, count: 1, me: true, people: [mine]});
    }
    return next;
}

function placeNear(anchor, width) {
    const r = anchor.getBoundingClientRect();
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, r.left + r.width / 2 - width / 2));
    const above = r.top > 220;
    return {
        left,
        top: above ? undefined : r.bottom + 8,
        bottom: above ? window.innerHeight - r.top + 8 : undefined,
        width,
    };
}

function useAnchorPos(anchor, width) {
    const [pos, setPos] = useState(null);
    useEffect(() => {
        if (!anchor) return undefined;
        const place = () => setPos(placeNear(anchor, width));
        place();
        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);
        return () => {
            window.removeEventListener("scroll", place, true);
            window.removeEventListener("resize", place);
        };
    }, [anchor, width]);
    return pos;
}

function Sheet({pos, children, panelRef, role}) {
    // `.glass-sheet` is `position: relative` (after Tailwind utilities),
    // so `fixed` must live on a wrapper — otherwise the picker paints at
    // the end of <body> and looks like a no-op.
    return (
        <div ref={panelRef} role={role}
             className="fixed z-[90] animate-pop-in"
             style={{left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width}}>
            <div className="glass-sheet rounded-2xl p-2 shadow-glow-volt overflow-hidden">
                <span className="glass-sheen rounded-[inherit]" aria-hidden="true"/>
                <div className="relative">{children}</div>
            </div>
        </div>
    );
}

function Popover({anchor, children, onClose, width = 220}) {
    const pos = useAnchorPos(anchor, width);
    const panelRef = useRef(null);
    useEffect(() => {
        if (!anchor) return undefined;
        const onPointer = (e) => {
            if (anchor.contains(e.target)) return;
            if (panelRef.current?.contains(e.target)) return;
            onClose();
        };
        const id = window.setTimeout(() => {
            document.addEventListener("pointerdown", onPointer);
        }, 0);
        return () => {
            window.clearTimeout(id);
            document.removeEventListener("pointerdown", onPointer);
        };
    }, [anchor, onClose]);
    if (!anchor || !pos) return null;
    return (
        <OverlayPortal>
            <Sheet pos={pos} panelRef={panelRef} role="dialog">{children}</Sheet>
        </OverlayPortal>
    );
}

function HoverTip({anchor, children, width = 220}) {
    const pos = useAnchorPos(anchor, width);
    if (!anchor || !pos) return null;
    return (
        <OverlayPortal>
            <div className="pointer-events-none">
                <Sheet pos={pos} role="tooltip">{children}</Sheet>
            </div>
        </OverlayPortal>
    );
}

function WhoList({people}) {
    return (
        <ul className="max-h-48 overflow-y-auto space-y-1">
            {people.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl px-2 py-1">
                    <ProfileAvatar user={{profile_picture: p.picture, first_name: p.name}} size={24}/>
                    <span className="text-sm font-semibold truncate">{p.name}</span>
                </li>
            ))}
        </ul>
    );
}

function FacePip({person, size = 14}) {
    const {src} = useProtectedImage(person.picture || null);
    return (
        <img src={src || "/profile.png"} alt=""
             width={size} height={size}
             className="rounded-full object-cover shrink-0 bg-ink-800"
             draggable={false}/>
    );
}

const StampCtx = createContext(null);

function useStamp() {
    return useContext(StampCtx);
}

function Sparks() {
    return (
        <span className="react-sparks" aria-hidden="true">
            {Array.from({length: 6}, (_, i) => (
                <i key={i} style={{"--a": `${i * 60}deg`}}/>
            ))}
        </span>
    );
}

function ReactChip({row, onToggle, onWho, delay, bursting, showWho}) {
    const spec = BY_ID[row.emoji];
    const btnRef = useRef(null);
    const hold = useRef(null);
    const held = useRef(false);
    const hoverTimer = useRef(null);
    const [hover, setHover] = useState(false);
    if (!spec) return null;

    const names = (row.people || []).map((p) => p.name).filter(Boolean);
    const whoLabel = names.length ? ` — ${names.join(", ")}` : "";

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                aria-pressed={row.me}
                aria-label={`${spec.label}${row.count ? `, ${row.count}` : ""}${whoLabel}`}
                onPointerDown={() => {
                    held.current = false;
                    hold.current = setTimeout(() => {
                        held.current = true;
                        onWho();
                    }, 380);
                }}
                onPointerUp={() => clearTimeout(hold.current)}
                onPointerCancel={() => clearTimeout(hold.current)}
                onMouseEnter={() => {
                    if (!finePointer()) return;
                    clearTimeout(hoverTimer.current);
                    hoverTimer.current = setTimeout(() => setHover(true), 120);
                }}
                onMouseLeave={() => {
                    clearTimeout(hoverTimer.current);
                    setHover(false);
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (held.current) return;
                    // Own stamp comes off only via the profile-pic button.
                    if (row.me) return;
                    onToggle();
                }}
                className={"react-chip relative inline-flex items-center gap-0.5 rounded-full pl-1 pr-1.5 py-0.5 min-h-[32px] text-[12px] font-bold tabular-nums transition " +
                    (row.me ? "react-chip-mine" : "btn-glass active:scale-95") +
                    (bursting ? " react-chip-burst" : "")}
                style={{"--react-glow": spec.glow, animationDelay: `${delay}s`}}>
                <StampGlyph id={row.emoji} size={22} glow={spec.glow}/>
                {row.count > 1 && <span className="text-[11px] leading-none">{row.count}</span>}
                {bursting && <Sparks/>}
            </button>
            {hover && !showWho && row.people?.length > 0 && (
                <HoverTip anchor={btnRef.current} width={220}>
                    <p className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.18em] flex items-center gap-1.5"
                       style={{color: spec.glow}}>
                        <StampGlyph id={row.emoji} size={16} glow={spec.glow}/>
                        {spec.label}
                    </p>
                    <WhoList people={row.people}/>
                </HoverTip>
            )}
        </>
    );
}

export function ActivityReactProvider({message, children}) {
    const {data: me} = useGetUserByIdQuery("me");
    const [reactTo] = useReactToActivityMutation();
    const [reacts, setReacts] = useState(message.reacts || []);
    const [picker, setPicker] = useState(false);
    const [who, setWho] = useState(null);
    const [burst, setBurst] = useState(null);
    const plusRef = useRef(null);
    const chipRefs = useRef({});
    const pending = useRef(0);
    const rollback = useRef(null);
    const burstTimer = useRef(null);

    useEffect(() => {
        if (pending.current) return;
        setReacts(message.reacts || []);
    }, [message.reacts, message.id]);

    useEffect(() => () => {
        clearTimeout(burstTimer.current);
    }, []);

    const meInfo = {
        id: me?.id,
        name: me?.first_name || me?.username || "You",
        picture: me?.profile_picture,
    };

    const mineEmoji = (reacts.find((row) => row.me) || {}).emoji || null;

    const api = useMemo(() => ({
        messageId: message.id,
        reacts,
        mineEmoji,
        meFace: meInfo,
        picker,
        setPicker,
        who,
        setWho,
        burst,
        plusRef,
        chipRefs,
        stamp(emoji) {
            if (!meInfo.id) return;
            const already = (reacts.find((r) => r.emoji === emoji) || {}).me;
            setReacts((cur) => {
                rollback.current = cur;
                return toggleLocal(cur, emoji, meInfo);
            });
            setPicker(false);
            setWho(null);
            if (!already) {
                setBurst(emoji);
                clearTimeout(burstTimer.current);
                burstTimer.current = setTimeout(() => setBurst(null), 560);
            }
            pending.current += 1;
            reactTo({id: message.id, emoji})
                .unwrap()
                .then((data) => { if (data?.reacts) setReacts(data.reacts); })
                .catch(() => setReacts(rollback.current || message.reacts || []))
                .finally(() => { pending.current = Math.max(0, pending.current - 1); });
        },
    }), [message.id, message.reacts, reacts, mineEmoji, picker, who, burst, meInfo.id, meInfo.name, meInfo.picture, reactTo]);

    return <StampCtx.Provider value={api}>{children}</StampCtx.Provider>;
}

export function ActivityStampIcons() {
    const api = useStamp();
    if (!api || !api.reacts.length) return null;
    const whoRow = api.who ? api.reacts.find((r) => r.emoji === api.who) : null;
    return (
        <div className="flex flex-wrap items-center justify-end gap-0.5 max-w-[11rem]"
             onClick={(e) => e.stopPropagation()} data-no-swipe="true">
            {api.reacts.map((row, i) => (
                <span key={row.emoji} ref={(el) => { api.chipRefs.current[row.emoji] = el; }}
                      className="react-chip-pop inline-flex">
                    <ReactChip
                        row={row}
                        delay={(i % 7) * 0.16}
                        bursting={api.burst === row.emoji}
                        showWho={api.who === row.emoji}
                        onToggle={() => api.stamp(row.emoji)}
                        onWho={() => { api.setPicker(false); api.setWho(row.emoji); }}
                    />
                </span>
            ))}
            {whoRow && (
                <Popover anchor={api.chipRefs.current[api.who]} onClose={() => api.setWho(null)} width={220}>
                    <p className="px-2 pt-1 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] flex items-center gap-1.5"
                       style={{color: BY_ID[whoRow.emoji]?.glow}}>
                        <StampGlyph id={whoRow.emoji} size={16} glow={BY_ID[whoRow.emoji]?.glow}/>
                        {BY_ID[whoRow.emoji]?.label}
                    </p>
                    <WhoList people={whoRow.people}/>
                </Popover>
            )}
        </div>
    );
}

export function ActivityStampButton() {
    const api = useStamp();
    if (!api) return null;
    const mine = api.mineEmoji;
    const spec = mine ? BY_ID[mine] : null;

    if (mine) {
        return (
            <div className="inline-flex" onClick={(e) => e.stopPropagation()} data-no-swipe="true">
                <button type="button"
                        aria-label="Remove your stamp"
                        onClick={(e) => {
                            e.stopPropagation();
                            api.setPicker(false);
                            api.stamp(mine);
                        }}
                        className="inline-flex items-center justify-center rounded-full overflow-hidden h-8 w-8 min-h-[32px] min-w-[32px] ring-1 ring-black/20 dark:ring-white/20"
                        style={spec ? {boxShadow: `0 0 0 1.5px ${spec.glow}`} : undefined}>
                    <FacePip person={api.meFace} size={32}/>
                </button>
            </div>
        );
    }

    return (
        <div className="inline-flex min-w-0 max-w-full align-middle"
             onClick={(e) => e.stopPropagation()} data-no-swipe="true">
            <button type="button" ref={api.plusRef}
                    aria-label="Add a reaction"
                    aria-expanded={api.picker}
                    onClick={(e) => {
                        e.stopPropagation();
                        api.setWho(null);
                        api.setPicker((v) => !v);
                    }}
                    className={STAMP_BTN}>
                <Plus className={"h-3.5 w-3.5 transition-transform " + (api.picker ? "rotate-45" : "")}/>
                <span>Stamp</span>
            </button>

            {api.picker && (
                <Popover anchor={api.plusRef.current} onClose={() => api.setPicker(false)} width={268}>
                    <p className="px-2 pt-1 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-volt-700 dark:text-volt-400">
                        Stamp it
                    </p>
                    <div className="grid grid-cols-4 gap-1">
                        {ACTIVITY_REACTS.map((spec, i) => (
                            <button key={spec.id} type="button"
                                    onClick={() => api.stamp(spec.id)}
                                    className="react-pick flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 min-h-[56px] transition"
                                    style={{"--react-glow": spec.glow, animationDelay: `${i * 28}ms`}}>
                                <StampGlyph id={spec.id} size={28} glow={spec.glow}/>
                                <span className="text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 leading-tight text-center">
                                    {spec.label}
                                </span>
                            </button>
                        ))}
                    </div>
                </Popover>
            )}
        </div>
    );
}

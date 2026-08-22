import React, {useCallback, useEffect, useRef, useState} from "react";
import {Flame, FlameKindling, X} from "lucide-react";
import {BoxSection} from "../utils/miscellaneous";
import {useGetDrillConfigsQuery, useGetRoastsQuery, useVoteRoastMutation} from "../utils/reducers/drillInstructorSlice";
import {fetchProtectedImage} from "../utils/protectedMedia";
import {timeAgo} from "../utils/time";
import usePollingInterval from "../utils/usePollingInterval";

// The coach's roasted photos as a hot-or-not swipe game: drag (or tap a
// button) right for HOT, left for NOPE. One card at a time, the next one
// peeks from behind; votes go to the server, tallies show on the card.
//
// Pointer-events based (mouse + touch), no dependency. The whole stack
// re-keys on `topId` so a fresh card always starts centered.

const SWIPE_THRESHOLD = 110;   // px of horizontal drag before the vote sticks
const FLY_OFF_MS = 260;

function RoastCard({card, top, onVote}) {
    // Drag state lives in refs (no re-render per pointermove frame);
    // the card node is transformed directly for 60fps dragging.
    const nodeRef = useRef(null);
    const stampHot = useRef(null);
    const stampNot = useRef(null);
    const drag = useRef(null);
    const [leaving, setLeaving] = useState(null); // "hot" | "not" during fly-off
    const {src} = useProtectedImageState(card.image);

    const applyTransform = useCallback((dx, animate) => {
        const el = nodeRef.current;
        if (!el) return;
        const rot = dx / 14;
        el.style.transition = animate ? "transform 180ms ease-out" : "none";
        el.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;
        const fade = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
        if (stampHot.current) stampHot.current.style.opacity = dx > 0 ? String(fade) : "0";
        if (stampNot.current) stampNot.current.style.opacity = dx < 0 ? String(fade) : "0";
    }, []);

    const settle = useCallback((hot) => {
        setLeaving(hot ? "hot" : "not");
        const el = nodeRef.current;
        if (el) {
            const dx = (hot ? 1 : -1) * (window.innerWidth);
            el.style.transition = `transform ${FLY_OFF_MS}ms ease-in`;
            el.style.transform = `translateX(${dx}px) rotate(${(hot ? 1 : -1) * 22}deg)`;
        }
        navigator.vibrate?.(30);
        setTimeout(() => onVote(hot), FLY_OFF_MS);
    }, [onVote]);

    function onPointerDown(e) {
        if (leaving) return;
        drag.current = {x0: e.clientX, dx: 0};
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    function onPointerMove(e) {
        if (!drag.current) return;
        drag.current.dx = e.clientX - drag.current.x0;
        applyTransform(drag.current.dx, false);
    }
    function onPointerUp() {
        if (!drag.current) return;
        const dx = drag.current.dx;
        drag.current = null;
        if (Math.abs(dx) >= SWIPE_THRESHOLD) {
            settle(dx > 0);
        } else {
            applyTransform(0, true); // snap back
        }
    }

    return (
        <div ref={nodeRef}
             onPointerDown={top ? onPointerDown : undefined}
             onPointerMove={top ? onPointerMove : undefined}
             onPointerUp={top ? onPointerUp : undefined}
             onPointerCancel={top ? onPointerUp : undefined}
             className={"absolute inset-0 select-none " + (top ? "cursor-grab active:cursor-grabbing touch-pan-y" : "pointer-events-none scale-[0.96] translate-y-2 opacity-70")}
             style={{zIndex: top ? 2 : 1}}>
            <div className="h-full w-full overflow-hidden rounded-3xl bg-white dark:bg-ink-850 border border-gray-200/70 dark:border-ink-700/60 shadow-card dark:shadow-card-dark flex flex-col">
                <div className="relative flex-1 min-h-0 bg-ink-950/95 flex items-center justify-center">
                    {src
                        ? <img src={src} alt={card.body || "Roasted"} draggable={false}
                               className="max-h-full max-w-full object-contain"/>
                        : <FlameKindling className="h-10 w-10 text-volt-400 animate-pulse"/>}
                    {/* HOT / NOPE stamps - opacity follows the drag */}
                    <div ref={stampHot} style={{opacity: 0}}
                         className="absolute top-4 left-4 -rotate-12 rounded-lg border-4 border-volt-400 px-3 py-1 font-display text-2xl uppercase tracking-widest text-volt-400">
                        Hot
                    </div>
                    <div ref={stampNot} style={{opacity: 0}}
                         className="absolute top-4 right-4 rotate-12 rounded-lg border-4 border-red-400 px-3 py-1 font-display text-2xl uppercase tracking-widest text-red-400">
                        Nope
                    </div>
                </div>
                <div className="px-4 py-3">
                    <p className="text-sm leading-snug break-words dark:text-gray-100 line-clamp-2">{card.body}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                        {card.persona_name} roasting {card.athlete_name || "an athlete"} · {card.competition_name} · {timeAgo(card.posted_at)}
                    </p>
                    <p className="text-[11px] mt-0.5 font-semibold">
                        <span className="text-volt-600 dark:text-volt-300">{card.hot_votes} hot</span>
                        <span className="text-gray-400"> · {card.not_votes} nope</span>
                        {card.my_vote !== null && card.my_vote !== undefined && (
                            <span className="text-gray-400"> · you said {card.my_vote ? "hot" : "nope"}</span>
                        )}
                    </p>
                </div>
            </div>
        </div>
    );
}

// Small wrapper so the hook name doesn't clash with the imported helper.
function useProtectedImageState(url) {
    const [state, setState] = useState({src: null});
    useEffect(() => {
        if (!url) {
            setState({src: null});
            return;
        }
        let alive = true;
        fetchProtectedImage(url).then((localUrl) => {
            if (alive) setState({src: localUrl});
        });
        return () => { alive = false; };
    }, [url]);
    return state;
}


export default function RoastSwipeBox() {
    const pollFast = usePollingInterval(60000);
    const {data: roasts} = useGetRoastsQuery(undefined, {pollingInterval: pollFast});
    const {data: configs} = useGetDrillConfigsQuery();
    const [voteRoast] = useVoteRoastMutation();
    // Cards already judged leave the stack (server also omits them).
    const [doneIds, setDoneIds] = useState([]);
    const [tallies, setTallies] = useState({});

    // The box exists when an image-edit model is configured (new roasts
    // can be produced) - or while unjudged roasts remain, so the game
    // doesn't vanish when the admin unsets the model.
    const imageModelSet = (configs || []).some((c) => c.image_edit_capable);
    const cards = (roasts || [])
        .map((c) => ({...c, ...(tallies[c.id] || {})}))
        .filter((c) => !doneIds.includes(c.id) && c.my_vote == null);
    const top = cards[0];
    const next = cards[1];

    // Preload the card behind the top one so the swipe feels instant.
    useEffect(() => {
        if (next?.image) fetchProtectedImage(next.image);
    }, [next?.image]);

    const handleVote = useCallback((hot) => {
        if (!top) return;
        const id = top.id;
        setDoneIds((prev) => [...prev, id]);
        voteRoast({id, hot}).unwrap()
            .then((res) => setTallies((prev) => ({...prev, [id]: {hot_votes: res.hot_votes, not_votes: res.not_votes}})))
            .catch(() => { /* the vote is fun, not finance - stay quiet */ });
    }, [top, voteRoast]);

    // After the hooks - early return must not reorder hook calls.
    if (!imageModelSet && !top) return null;

    if (!top) {
        return (
            <BoxSection>
                <h2 className="font-display text-sm uppercase tracking-wider flex items-center gap-2 mb-2">
                    <Flame className="h-4 w-4 text-volt-500"/> Hot or Not: Roast Edition
                </h2>
                <p className="text-sm text-gray-400 px-2 py-3">
                    No new roasts to judge. Post a picture in your challenge's Coach's Corner and
                    the coach will cook one up — each picture can only be rated once.
                </p>
            </BoxSection>
        );
    }

    return (
        <BoxSection>
            <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm uppercase tracking-wider flex items-center gap-2">
                    <Flame className="h-4 w-4 text-volt-500"/> Hot or Not: Roast Edition
                </h2>
                <span className="text-[11px] text-gray-400">{cards.length} left</span>
            </div>

            <div className="relative mx-auto w-full max-w-sm" style={{height: 420}}>
                {next && <RoastCard key={next.id} card={next} top={false} onVote={() => {}}/>}
                <RoastCard key={top.id} card={top} top onVote={handleVote}/>
            </div>

            <div className="mt-3 flex items-center justify-center gap-6">
                <button onClick={() => handleVote(false)} aria-label="Nope"
                        className="min-h-[52px] min-w-[52px] rounded-full bg-gray-100 dark:bg-ink-800 text-red-400 hover:bg-red-50 dark:hover:bg-ink-700 transition flex items-center justify-center border border-gray-200/70 dark:border-ink-700/60">
                    <X className="h-6 w-6"/>
                </button>
                <button onClick={() => handleVote(true)} aria-label="Hot"
                        className="min-h-[52px] min-w-[52px] rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 transition shadow-glow-volt flex items-center justify-center">
                    <Flame className="h-6 w-6"/>
                </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-gray-400">Drag the card or tap: flame = hot, X = nope.</p>
        </BoxSection>
    );
}

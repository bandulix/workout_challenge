import React, {useEffect, useRef, useState} from "react";
import {ChevronLeft, ChevronRight} from "lucide-react";


export const CHALLENGE_TABS = [
    {id: "feed", label: "Feed"},
    {id: "board", label: "Board"},
    {id: "trophies", label: "Trophies"},
];


function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        const apply = () => setReduced(mq.matches);
        apply();
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
    }, []);
    return reduced;
}


function isInteractive(el) {
    // Inputs and links keep their own gestures. Feed/list rows are
    // buttons - skipping those would leave nowhere to swipe.
    return !!el.closest?.("input, textarea, select, a, label, [data-no-swipe], .modal-background");
}


export function ChallengeTabBar({tab, onChange, dragRatio = 0}) {
    const idx = Math.max(0, CHALLENGE_TABS.findIndex((t) => t.id === tab));
    const last = CHALLENGE_TABS.length - 1;

    return (
        <div className="mb-3" data-no-swipe>
            <div className="flex items-center justify-center gap-1">
                <button type="button" aria-label="Previous page" disabled={idx === 0}
                        onClick={() => onChange(CHALLENGE_TABS[idx - 1].id)}
                        className={"shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition " +
                            (idx === 0
                                ? "text-gray-300/80 dark:text-ink-600 cursor-default"
                                : "text-gray-400 hover:text-volt-600 dark:hover:text-volt-400")}>
                    <ChevronLeft className="h-4 w-4"/>
                </button>

                <div className="flex items-center gap-0.5" role="tablist"
                     aria-label="Challenge pages. Swipe left or right to switch.">
                    {CHALLENGE_TABS.map((t, i) => (
                        <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                                onClick={() => onChange(t.id)}
                                className={"relative px-3 py-1 min-h-[36px] text-[11px] font-bold uppercase tracking-[0.16em] transition " +
                                    (tab === t.id
                                        ? "text-volt-700 dark:text-volt-400"
                                        : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300")}>
                            {t.label}
                            <span aria-hidden="true"
                                  className={"absolute left-1/2 -translate-x-1/2 bottom-0.5 h-[2px] rounded-full bg-volt-400 transition-all " +
                                      (i === idx ? "w-4 opacity-100" : "w-0 opacity-0")}
                                  style={i === idx && dragRatio
                                      ? {transform: `translateX(calc(-50% + ${dragRatio * 28}px))`}
                                      : undefined}/>
                        </button>
                    ))}
                </div>

                <button type="button" aria-label="Next page" disabled={idx === last}
                        onClick={() => onChange(CHALLENGE_TABS[idx + 1].id)}
                        className={"shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition " +
                            (idx === last
                                ? "text-gray-300/80 dark:text-ink-600 cursor-default"
                                : "text-gray-400 hover:text-volt-600 dark:hover:text-volt-400")}>
                    <ChevronRight className="h-4 w-4"/>
                </button>
            </div>
        </div>
    );
}


export function SwipePages({tab, onChange, children}) {
    const pages = React.Children.toArray(children);
    const idx = Math.max(0, CHALLENGE_TABS.findIndex((t) => t.id === tab));
    const last = CHALLENGE_TABS.length - 1;
    const wrapRef = useRef(null);
    const startRef = useRef(null);
    const dxRef = useRef(0);
    const [dx, setDx] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [paneW, setPaneW] = useState(0);
    const reduced = usePrefersReducedMotion();

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setPaneW(el.clientWidth);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    function setOffset(value) {
        dxRef.current = value;
        setDx(value);
    }

    function onPointerDown(e) {
        if (e.pointerType === "mouse" && e.buttons !== 1) return;
        if (isInteractive(e.target)) return;
        startRef.current = {x: e.clientX, y: e.clientY, id: e.pointerId, axis: null};
    }

    function onPointerMove(e) {
        const start = startRef.current;
        if (!start || e.pointerId !== start.id) return;
        const x = e.clientX - start.x;
        const y = e.clientY - start.y;
        if (start.axis == null) {
            if (Math.hypot(x, y) < 12) return;
            start.axis = Math.abs(x) > Math.abs(y) * 1.2 ? "x" : "y";
            if (start.axis === "x") {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                setDragging(true);
            }
        }
        if (start.axis !== "x") return;
        let next = x;
        if ((idx === 0 && next > 0) || (idx === last && next < 0)) next *= 0.28;
        setOffset(next);
    }

    function finish(e) {
        const start = startRef.current;
        startRef.current = null;
        if (!start || start.axis !== "x") {
            setOffset(0);
            setDragging(false);
            return;
        }
        const width = wrapRef.current?.clientWidth || window.innerWidth;
        const threshold = Math.min(72, width * 0.18);
        const delta = dxRef.current;
        let nextIdx = idx;
        if (delta < -threshold && idx < last) nextIdx = idx + 1;
        else if (delta > threshold && idx > 0) nextIdx = idx - 1;
        setOffset(0);
        setDragging(false);
        if (nextIdx !== idx) onChange(CHALLENGE_TABS[nextIdx].id);
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }

    const width = paneW || wrapRef.current?.clientWidth || 1;
    const dragRatio = dragging ? (-dx / width) : 0;

    return (
        <div ref={wrapRef} className={"overflow-x-hidden touch-pan-y " + (dragging ? "select-none" : "")}
             onPointerDown={onPointerDown}
             onPointerMove={onPointerMove}
             onPointerUp={finish}
             onPointerCancel={finish}>
            <ChallengeTabBar tab={tab} onChange={onChange} dragRatio={dragRatio}/>
            <div className="flex"
                 style={{
                     width: paneW ? paneW * pages.length : "300%",
                     transform: `translateX(${-idx * width + dx}px)`,
                     transition: dragging || reduced ? "none" : "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
                 }}>
                {pages.map((page, i) => {
                    const near = i === idx || (dragging && Math.abs(i - idx) === 1);
                    return (
                        <div key={CHALLENGE_TABS[i].id}
                             className="shrink-0"
                             role="tabpanel"
                             aria-hidden={i !== idx}
                             style={{
                                 width: paneW || "33.333%",
                                 visibility: near ? "visible" : "hidden",
                                 height: near ? "auto" : 0,
                                 overflow: near ? "visible" : "hidden",
                             }}>
                            {page}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

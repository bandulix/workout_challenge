import React, {useEffect, useState} from "react";
import {prefersReducedMotion} from "../utils/motion";

/** One ring, three sizes. Pass a number for a one-off diameter. */
export const RING_SIZE = {lg: 96, md: 56, sm: 28};

export function MetricRing({
    size = "lg",
    value = null,
    max = 100,
    color = "var(--volt)",
    display,
    label,
    unit,
    children,
}) {
    const px = typeof size === "number" ? size : (RING_SIZE[size] || 56);
    const stroke = px >= 80 ? 8 : px >= 48 ? 5 : 3;
    const radius = (px - stroke) / 2 - 1;
    const length = 2 * Math.PI * radius;
    const empty = value == null || display === "--%" || display === "--";
    const ratio = empty || !(max > 0) ? 0 : Math.max(0, Math.min(1, Number(value) / max));
    const offset = length * (1 - ratio);
    const mid = px / 2;
    const shown = display == null ? "" : display;
    return (
        <div className="flex flex-col items-center gap-1">
            <span className="relative inline-flex items-center justify-center" style={{width: px, height: px}}>
                <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden="true" className="absolute inset-0">
                    <circle cx={mid} cy={mid} r={radius} fill="none" stroke="var(--hairline)" strokeWidth={stroke}/>
                    {!empty && ratio > 0 && (
                        <circle
                            cx={mid} cy={mid} r={radius} fill="none" stroke={color} strokeWidth={stroke}
                            strokeLinecap="round"
                            transform={`rotate(-90 ${mid} ${mid})`}
                            className="ds-ring-draw"
                            style={{
                                strokeDasharray: length,
                                strokeDashoffset: offset,
                                "--ring-len": length,
                                "--ring-off": offset,
                            }}
                        />
                    )}
                </svg>
                <span className="relative flex items-center justify-center">
                    {children || (
                        <span className="t-stat font-bold leading-none text-ink-950 dark:text-white" style={{fontSize: px >= 80 ? 22 : px >= 48 ? 13 : 10}}>
                            {shown}
                        </span>
                    )}
                </span>
            </span>
            {label && <span className="t-label text-muted">{label}</span>}
            {unit && <span className="t-micro -mt-0.5 text-muted">{unit}</span>}
        </div>
    );
}

/** 270° arc. The opening sits at the bottom. */
export function ArcGauge({value, max = 100, color = "var(--volt)", display, caption}) {
    const radius = 64;
    const length = 2 * Math.PI * radius;
    const arc = length * 0.75;
    const empty = value == null;
    const ratio = empty || !(max > 0) ? 0 : Math.max(0, Math.min(1, Number(value) / max));
    const drawn = arc * ratio;
    return (
        <div className="flex flex-col items-center">
            <div className="relative h-[148px] w-[168px]">
                <svg width="168" height="168" viewBox="0 0 168 168" aria-hidden="true" className="absolute left-0 top-0">
                    <circle cx="84" cy="84" r={radius} fill="none" stroke="var(--hairline)" strokeWidth="12"
                            strokeLinecap="round" strokeDasharray={`${arc} ${length}`} transform="rotate(135 84 84)"/>
                    {!empty && (
                        <circle cx="84" cy="84" r={radius} fill="none" stroke={color} strokeWidth="12"
                                strokeLinecap="round" transform="rotate(135 84 84)"
                                className="ds-ring-draw"
                                style={{
                                    strokeDasharray: `${arc} ${length}`,
                                    strokeDashoffset: arc - drawn,
                                    "--ring-len": arc,
                                    "--ring-off": arc - drawn,
                                }}/>
                    )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center pt-2">
                    <span className="t-display text-ink-950 dark:text-white">{empty ? "--" : display}</span>
                </div>
            </div>
            {caption && <p className="t-body -mt-1 max-w-xs text-center text-muted">{caption}</p>}
        </div>
    );
}

export function useCountUp(target, ms = 400) {
    const end = Number(target);
    const [value, setValue] = useState(() => (prefersReducedMotion() || !Number.isFinite(end) ? end : 0));
    useEffect(() => {
        if (!Number.isFinite(end)) {
            setValue(end);
            return undefined;
        }
        if (prefersReducedMotion()) {
            setValue(end);
            return undefined;
        }
        let frame = 0;
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / ms);
            const eased = 1 - Math.pow(1 - t, 3);
            setValue(end * eased);
            if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [end, ms]);
    return value;
}

export function WeightBar({label, detail, share, tone = "var(--good)"}) {
    const width = Math.max(0, Math.min(100, Number(share) || 0));
    return (
        <div>
            <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-ink-950 dark:text-white">{label}</p>
                <p className="t-stat t-micro text-muted">{Math.round(width)}% of score</p>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{background: "var(--hairline)"}}>
                <div className="h-full rounded-full" style={{width: `${width}%`, background: tone}}/>
            </div>
            {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
        </div>
    );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Day 1 · Sat 18", or "Today · Sat 24" when the row is the local today. */
export function duelDayLabel(iso, index = 0, today = new Date()) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!match) return String(iso || "");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    const stamp = `${WEEKDAYS[date.getDay()]} ${day}`;
    const isToday = today.getFullYear() === year && today.getMonth() === month - 1 && today.getDate() === day;
    if (isToday) return `Today · ${stamp}`;
    return `Day ${index + 1} · ${stamp}`;
}

export function PairedBars({rows, youLabel = "You", themLabel = "Them"}) {
    const list = Array.isArray(rows) ? rows : [];
    const peak = Math.max(1, ...list.flatMap((row) => [Number(row.you) || 0, Number(row.them) || 0]));
    if (!list.length) return null;
    return (
        <div role="img" aria-label="Paired daily bars">
            <div className="mb-2 flex gap-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{background: "var(--volt)"}}/>{youLabel}</span>
                <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{background: "var(--other)"}}/>{themLabel}</span>
            </div>
            <ul className="space-y-1">
                {list.map((row, index) => {
                    const you = Number(row.you) || 0;
                    const them = Number(row.them) || 0;
                    const level = you > 0 && Math.abs(you - them) < 0.05;
                    const raw = row.label || row.date;
                    const caption = /^\d{4}-\d{2}-\d{2}/.test(String(raw || "")) ? duelDayLabel(raw, index) : raw;
                    return (
                    <li key={row.date || row.label || index}>
                        <div className="mb-0.5 flex justify-between t-micro text-muted">
                            <span>{caption}</span>
                            {level ? <span className="font-bold uppercase tracking-wide" style={{color: "var(--mid)"}}>Dead heat</span> : null}
                        </div>
                        <div className="space-y-0.5">
                            <div className="h-1.5 overflow-hidden rounded-full" style={{background: "var(--hairline)"}}>
                                <div className="h-full rounded-full" style={{width: `${((Number(row.you) || 0) / peak) * 100}%`, background: "var(--volt)"}}/>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full" style={{background: "var(--hairline)"}}>
                                <div className="h-full rounded-full" style={{width: `${((Number(row.them) || 0) / peak) * 100}%`, background: "var(--other)"}}/>
                            </div>
                        </div>
                    </li>
                    );
                })}
            </ul>
        </div>
    );
}

export function DayDots({total = 0, days = []}) {
    const count = Math.max(0, Number(total) || 0);
    if (!count) return null;
    return (
        <div className="flex flex-wrap gap-1.5" role="img" aria-label={`${count} day duel`}>
            {Array.from({length: count}, (_, index) => {
                const day = days[index];
                const you = Number(day?.you) || 0;
                const them = Number(day?.them) || 0;
                let background = "var(--hairline)";
                if (day && you === them && (you > 0 || them > 0)) background = "var(--mid)";
                else if (you > them) background = "var(--volt)";
                else if (them > you) background = "var(--other)";
                return <span key={index} className="h-2.5 w-2.5 rounded-full" style={{background}}/>;
            })}
        </div>
    );
}

export function RecordPills({record}) {
    const wins = record?.wins || 0;
    const losses = record?.losses || 0;
    const ties = record?.ties || 0;
    if (!wins && !losses && !ties) return null;
    const pills = [
        ["W", wins, "var(--good-ink)"],
        ["L", losses, "var(--low-ink)"],
        ["T", ties, "var(--mid-ink)"],
    ];
    return (
        <span className="inline-flex gap-1" aria-label={`Duels ${wins}-${losses}-${ties}`}>
            {pills.map(([mark, count, color]) => (
                <span key={mark} className="t-stat t-label rounded-full px-2 py-0.5" style={{color, background: "var(--surface-1)", border: "1px solid var(--hairline)"}}>
                    {mark} {count}
                </span>
            ))}
        </span>
    );
}

export function MissingCard({title, body, action, when}) {
    return (
        <article className="rounded-[20px] p-4" style={{background: "var(--surface-2)", border: "1px solid var(--hairline)"}}>
            <p className="t-label text-muted">Missing</p>
            <p className="t-h2 mt-1 text-ink-950 dark:text-white">{title}</p>
            {body && <p className="t-body mt-1 text-muted">{body}</p>}
            {action && <p className="mt-2 text-sm font-semibold text-ink-950 dark:text-white">{action}</p>}
            {when && <p className="t-micro mt-1 text-muted">{when}</p>}
        </article>
    );
}

const PART_LABEL = {
    hrv: "HRV",
    rhr: "Resting HR",
    sleep: "Sleep",
    load: "Training load",
    body_battery: "Body battery",
    training_readiness: "Training readiness",
    stress: "Stress",
    checkin: "Check-in",
};

export function ContributorList({components}) {
    const entries = Object.entries(components || {});
    if (!entries.length) return null;
    const total = entries.reduce((sum, [, part]) => sum + (Number(part?.weight) || 0), 0) || 1;
    return (
        <div className="space-y-3">
            <p className="t-label text-muted">Why</p>
            {entries.map(([name, part]) => (
                <WeightBar
                    key={name}
                    label={PART_LABEL[name] || name}
                    detail={part?.detail}
                    share={((Number(part?.weight) || 0) / total) * 100}
                />
            ))}
        </div>
    );
}

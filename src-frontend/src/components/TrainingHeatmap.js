import React, {useMemo} from "react";

// GitHub-style training heatmap: 26 weeks x 7 days, fed by the summary
// endpoint's `days` map (day ISO -> trained seconds). Volt intensity
// follows minutes trained: rest / <30 / <60 / 60+. Above it a 12-week
// volume strip (minutes per week) for the trend at a glance.

const LEVELS = [
    {max: 0, cls: "bg-ink-950/8 dark:bg-white/8"},
    {max: 30 * 60, cls: "bg-volt-400/35"},
    {max: 60 * 60, cls: "bg-volt-400/70"},
    {max: Infinity, cls: "bg-volt-400 shadow-[0_0_6px_rgba(215,255,62,0.5)]"},
];

export function levelFor(seconds) {
    if (!seconds || seconds <= 0) return 0;
    if (seconds < 30 * 60) return 1;
    if (seconds < 60 * 60) return 2;
    return 3;
}

export function heatmapWeeks(days, today = new Date()) {
    // Monday of the current week is the anchor of the last column.
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const weeks = [];
    for (let w = 25; w >= 0; w -= 1) {
        const col = [];
        for (let d = 0; d < 7; d += 1) {
            const date = new Date(thisMonday);
            date.setDate(thisMonday.getDate() - w * 7 + d);
            const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            col.push({
                iso,
                seconds: days?.[iso] || 0,
                future: date > today,
            });
        }
        weeks.push(col);
    }
    return weeks;
}

export function weeklyMinutes(weeks) {
    return weeks.map((col) => col.reduce((s, c) => s + c.seconds, 0) / 60);
}

export default function TrainingHeatmap({days}) {
    const weeks = useMemo(() => heatmapWeeks(days), [days]);
    const volume = useMemo(() => weeklyMinutes(weeks).slice(-12), [weeks]);
    const maxVol = Math.max(1, ...volume);

    return (
        <div className="mt-5">
            <p className="t-caption text-gray-400 mb-2">Last 12 weeks · minutes</p>
            <div className="flex items-end gap-[3px] h-10" role="img"
                 aria-label={"Weekly minutes, oldest to newest: " + volume.map((v) => Math.round(v)).join(", ")}>
                {volume.map((v, i) => (
                    <div key={i} className="flex-1 min-w-[4px] rounded-[3px] bg-volt-400/85"
                         style={{height: Math.max(2, Math.round((v / maxVol) * 40))}}
                         title={`${Math.round(v)} min`}/>
                ))}
            </div>
            <p className="t-caption text-gray-400 mt-4 mb-2">Last 26 weeks</p>
            <div className="grid grid-flow-col gap-[3px]" role="img"
                 aria-label="Training heatmap: each column is a week (Monday to Sunday), brighter means more minutes">
                {weeks.map((col, i) => (
                    <div key={i} className="grid grid-rows-7 gap-[3px]">
                        {col.map((c) => (
                            <div key={c.iso}
                                 title={`${c.iso} · ${Math.round(c.seconds / 60)} min`}
                                 className={"aspect-square w-full rounded-[3px] " +
                                     (c.future ? "opacity-15 " + LEVELS[0].cls : LEVELS[levelFor(c.seconds)].cls)}/>
                        ))}
                    </div>
                ))}
            </div>
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-gray-400">
                <span>Rest</span>
                {LEVELS.map((l, i) => (
                    <span key={i} className={"h-2.5 w-2.5 rounded-[2px] " + l.cls} aria-hidden="true"/>
                ))}
                <span>60+ min</span>
            </div>
        </div>
    );
}

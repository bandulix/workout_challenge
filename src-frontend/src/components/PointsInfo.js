import React from "react";
import {Modal} from "../forms/basicComponents";
import {useGetPointsFactorsQuery} from "../utils/reducers/competitionsSlice";
import {sportLabelShort} from "../forms/workoutForm";

// "How points work" - per-challenge transparency view: the goals of THIS
// competition (targets, periods, caps) plus the site-wide activity-type
// factors and the personal equalizer, rendered as plain formulas.

const METRIC_TEXT = {
    min: {unit: "active minutes", formula: (g) => `points = active minutes ÷ ${g} × 100`},
    num: {unit: "activities", formula: (g) => `points = 1 ÷ ${g} × 100 per activity`},
    kcal: {unit: "kcal", formula: (g) => `points = kcal ÷ (${g} × your effort factor) × 100`},
    km: {unit: "km", formula: (g) => `points = km ÷ (${g} × your distance factor) × 100`},
    kj: {unit: "kJ", formula: (g) => `points = kcal × 4.18 ÷ (${g} × your effort factor) × 100`},
};

const PERIOD_TEXT = {
    day: "per day",
    week: "per week",
    month: "per month",
    year: "per year",
    competition: "for the whole challenge",
};

function capFloorText(goal, scaling) {
    const lines = [];
    const unit = METRIC_TEXT[goal.metric]?.unit ?? goal.metric;
    const push = (label, min, max) => {
        const parts = [];
        if (min !== null && min !== undefined) parts.push(`at least ${Math.round(min * scaling)} ${unit} count`);
        if (max !== null && max !== undefined) parts.push(`capped at ${Math.round(max * scaling)} ${unit}`);
        if (parts.length) lines.push(`${label}: ${parts.join(", ")}`);
    };
    push("Per activity", goal.min_per_workout, goal.max_per_workout);
    push("Per day", goal.min_per_day, goal.max_per_day);
    push("Per week", goal.min_per_week, goal.max_per_week);
    return lines;
}

// Personal equalizer scaling for a goal's metric - same math as the
// goal boxes on the challenge page, so both views show the same numbers.
function metricScaling(metric, user) {
    if (["kcal", "kj"].includes(metric)) return Number(user?.scaling_kcal ?? 1);
    if (metric === "km") return Number(user?.scaling_distance ?? 1);
    return 1;
}


export default function PointsInfoModal({competition, goals, user, setModalState}) {
    // Fresh on every open: the slice caches aggressively (12h), but an
    // admin edit must be visible the next time someone opens this view.
    const {data} = useGetPointsFactorsQuery(undefined, {refetchOnMountOrArgChange: true});
    const factors = data?.factors || {};
    const nonNeutral = Object.entries(factors).filter(([, v]) => v !== 1.0);

    return (
        <Modal title="How Points Work" landscape={false} setShowModal={setModalState}>
            <div className="text-sm text-gray-700 dark:text-gray-300 space-y-5 max-h-[65vh] overflow-y-auto pr-1">

                <div>
                    <p className="font-bold mb-1">Goals in “{competition.name}”</p>
                    {(goals || []).map((goal) => {
                        const scaling = metricScaling(goal.metric, user);
                        const target = Math.round(Number(goal.goal) * scaling);
                        const scaledNote = scaling !== 1 ? ` (${goal.goal} × your ${Math.round(scaling * 100)}% factor)` : "";
                        return (
                            <div key={goal.id} className="mb-3 rounded-xl bg-gray-50 dark:bg-ink-900 p-3">
                                <p className="font-semibold">{goal.name}: {target.toLocaleString()} {METRIC_TEXT[goal.metric]?.unit ?? goal.metric} {PERIOD_TEXT[goal.period] ?? goal.period}{scaledNote}</p>
                                <p className="font-mono text-xs text-gray-600 dark:text-gray-400 mt-1">
                                    {METRIC_TEXT[goal.metric]?.formula(goal.goal) ?? ""} × activity-type factor
                                </p>
                                {capFloorText(goal, scaling).map((line, i) => (
                                    <p key={i} className="text-xs text-gray-500 mt-0.5">{line}</p>
                                ))}
                                {!goal.count_steps_as_walks && (
                                    <p className="text-xs text-gray-500 mt-0.5">Daily step totals do not count for this goal.</p>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div>
                    <p className="font-bold mb-1">Activity-type factors</p>
                    {nonNeutral.length === 0 ? (
                        <p className="text-gray-500">Every activity type currently counts the same (factor 1.00).</p>
                    ) : (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            {nonNeutral.map(([sport, factor]) => (
                                <p key={sport} className="flex justify-between">
                                    <span>{sportLabelShort(sport)}</span>
                                    <span className="font-mono">×{Number(factor).toFixed(2)}</span>
                                </p>
                            ))}
                        </div>
                    )}
                </div>

                <div>
                    <p className="font-bold mb-1">Fair-play equalizer</p>
                    <p>
                        Calorie-based goals (kcal, kJ) are divided by <b>your personal effort factor</b> and
                        distance goals (km) by <b>your distance factor</b> - estimated from your body stats in
                        the goal equalizer (My Space → Equalize Goals), so different bodies compete fairly.
                    </p>
                    {(user?.scaling_kcal && user?.scaling_distance) ? (
                        <p className="mt-1 text-gray-500">
                            Your factors: {Math.round(Number(user.scaling_kcal) * 100)}% effort / {Math.round(Number(user.scaling_distance) * 100)}% distance.
                        </p>
                    ) : null}
                </div>

                <p className="text-xs text-gray-500 italic">
                    Points above a cap are discarded; floors must be passed before points count.
                    Daily/weekly caps reset with each new day/week.
                </p>
            </div>
        </Modal>
    );
}

import React, {useMemo, useState} from "react";
import {useDispatch} from "react-redux";
import {Check, ChevronDown, Minus, Plus, Search} from "lucide-react";
import {useAddWorkoutMutation} from "../utils/reducers/workoutsSlice";
import {statsApi} from "../utils/reducers/statsSlice";
import {feedApi} from "../utils/reducers/feedSlice";
import {Modal} from "./basicComponents";
import {clearBodyScrollLock} from "../utils/overlay";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";
import {refreshChallengeSoon, sportIcon, workoutTypes} from "../utils/sports";

// Two taps to a saved workout: a sport, a duration. Everything else has a
// sensible default and lives behind "More". Edits still use the full form.

const RECENT_KEY = "wc-recent-sports";
const DEFAULT_SPORTS = ["Run", "Ride", "Swim", "WeightTraining", "Walk", "Yoga", "Hike", "HighIntensityIntervalTraining"];
const DURATIONS = [20, 30, 45, 60, 90];
export const INTENSITIES = [
    {value: 1, label: "Easy", className: "bg-sky-400/20 text-sky-200 ring-sky-300/60"},
    {value: 2, label: "Moderate", className: "bg-volt-400/20 text-volt-200 ring-volt-300/60"},
    {value: 3, label: "Hard", className: "bg-orange-400/20 text-orange-200 ring-orange-300/60"},
    {value: 4, label: "All out", className: "bg-rose-500/20 text-rose-200 ring-rose-300/60"},
];

export function readRecentSports() {
    try {
        const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
        const known = (Array.isArray(raw) ? raw : []).filter((key) => workoutTypes[key] && key !== "Steps");
        const merged = [...known, ...DEFAULT_SPORTS.filter((key) => !known.includes(key))];
        return merged.slice(0, 8);
    } catch {
        return DEFAULT_SPORTS;
    }
}

export function rememberSport(sportType) {
    if (!sportType || sportType === "Steps") return;
    try {
        const current = readRecentSports().filter((key) => key !== sportType);
        window.localStorage.setItem(RECENT_KEY, JSON.stringify([sportType, ...current].slice(0, 8)));
    } catch {
        // Storage can be unavailable (private mode); the grid falls back to defaults.
    }
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function localNow() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function minutesToDuration(minutes) {
    const total = Math.max(1, Math.round(Number(minutes) || 0));
    return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}:00`;
}

function Chip({active, children, onClick, className = "", ariaLabel}) {
    return (
        <button
            aria-label={ariaLabel}
            aria-pressed={active}
            className={"min-h-[44px] rounded-full px-4 text-sm font-bold transition active:scale-95 " +
                (active ? "bg-volt-400 text-ink-950 shadow-glow-volt" : "btn-glass text-white/80") + " " + className}
            onClick={onClick}
            type="button"
        >
            {children}
        </button>
    );
}

function SportPicker({value, onPick}) {
    const [query, setQuery] = useState("");
    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        return Object.entries(workoutTypes)
            .filter(([key, meta]) => !q || meta.label.toLowerCase().includes(q) || key.toLowerCase().includes(q))
            .slice(0, 40);
    }, [query]);
    return (
        <div className="mt-3 rounded-2xl bg-ink-950/40 p-3">
            <label className="flex items-center gap-2 rounded-full bg-white/10 px-3">
                <Search aria-hidden="true" className="h-4 w-4 text-white/60"/>
                <input
                    aria-label="Search sports"
                    autoFocus
                    className="min-h-[44px] w-full bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search sports"
                    value={query}
                />
            </label>
            <ul className="mt-2 max-h-56 overflow-y-auto overscroll-contain">
                {matches.map(([key, meta]) => {
                    const Icon = sportIcon(key);
                    return (
                        <li key={key}>
                            <button
                                className={"flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 text-left text-sm " +
                                    (key === value ? "bg-volt-400/15 text-volt-200" : "text-white/85 hover:bg-white/10")}
                                onClick={() => onPick(key)}
                                type="button"
                            >
                                <Icon aria-hidden="true" className="h-4 w-4 shrink-0"/>
                                <span className="flex-1">{meta.label}</span>
                                {key === value && <Check aria-hidden="true" className="h-4 w-4"/>}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export default function QuickLogSheet({setModalState}) {
    const dispatch = useDispatch();
    const [createEntry, {isLoading}] = useAddWorkoutMutation();
    const [recent] = useState(() => readRecentSports());
    const [sport, setSport] = useState(recent[0] || "Run");
    const [minutes, setMinutes] = useState(30);
    const [intensity, setIntensity] = useState(2);
    const [moreOpen, setMoreOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [startAt, setStartAt] = useState(() => localNow());
    const [kcal, setKcal] = useState("");
    const [distance, setDistance] = useState("");
    const [steps, setSteps] = useState("");
    const [error, setError] = useState("");

    const isSteps = sport === "Steps";
    const gridSports = recent.includes(sport) ? recent : [sport, ...recent].slice(0, 8);
    const SelectedIcon = sportIcon(sport);
    const sportLabel = workoutTypes[sport]?.label_short || sport;

    async function save() {
        setError("");
        const body = {
            sport_type: sport,
            start_datetime: isSteps ? `${startAt.substring(0, 10)}T23:59` : startAt,
            duration: minutesToDuration(minutes),
            intensity_category: intensity,
            kcal: kcal === "" ? null : kcal,
            distance: distance === "" ? null : distance,
            steps: isSteps ? (steps === "" ? null : steps) : null,
        };
        try {
            await createEntry(body).unwrap();
        } catch (err) {
            const fieldMessage = err?.data && typeof err.data === "object"
                ? Object.values(err.data).flat().find((v) => typeof v === "string")
                : null;
            setError(fieldMessage || errText(err, "Could not save the workout. Please try again."));
            return;
        }
        rememberSport(sport);
        dispatch(statsApi.util.invalidateTags(["Stats"]));
        dispatch(feedApi.util.invalidateTags(["Feed"]));
        refreshChallengeSoon(dispatch);
        window.dispatchEvent(new CustomEvent("wc:logged", {detail: {sport, minutes: Number(minutes), intensity}}));
        setModalState(false);
        clearBodyScrollLock();
        toast.success(`${sportLabel} · ${minutes} min logged.`);
    }

    return (
        <Modal title="Log" setShowModal={setModalState} isLoading={isLoading}>
            <div className="px-2 text-white">
                <p className="t-pane text-white/60">Sport</p>
                <div className="mt-2 grid grid-cols-4 gap-2">
                    {gridSports.map((key) => {
                        const Icon = sportIcon(key);
                        const active = key === sport;
                        return (
                            <button
                                aria-label={workoutTypes[key]?.label || key}
                                aria-pressed={active}
                                className={"flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1 text-[11px] font-bold uppercase tracking-wide transition active:scale-95 " +
                                    (active ? "bg-volt-400 text-ink-950 shadow-glow-volt" : "glass-well text-white/80")}
                                key={key}
                                onClick={() => { setSport(key); setPickerOpen(false); }}
                                type="button"
                            >
                                <Icon aria-hidden="true" className="h-6 w-6"/>
                                <span className="truncate max-w-full">{workoutTypes[key]?.label_short || key}</span>
                            </button>
                        );
                    })}
                </div>
                <button
                    aria-expanded={pickerOpen}
                    className="mt-2 flex min-h-[44px] items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-white/60"
                    onClick={() => setPickerOpen((v) => !v)}
                    type="button"
                >
                    <Search aria-hidden="true" className="h-3.5 w-3.5"/> All sports
                </button>
                {pickerOpen && <SportPicker value={sport} onPick={(key) => { setSport(key); setPickerOpen(false); }}/>}

                {isSteps ? (
                    <>
                        <p className="t-pane mt-5 text-white/60">Steps</p>
                        <input
                            aria-label="Total daily steps"
                            className="mt-2 min-h-[44px] w-full rounded-2xl bg-white/10 px-4 text-base text-white outline-none"
                            inputMode="numeric"
                            onChange={(e) => setSteps(e.target.value)}
                            placeholder="Total steps for the day"
                            value={steps}
                        />
                    </>
                ) : (
                    <>
                        <p className="t-pane mt-5 text-white/60">Duration</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            {DURATIONS.map((d) => (
                                <Chip active={Number(minutes) === d} key={d} onClick={() => setMinutes(d)}>{d}</Chip>
                            ))}
                            <span className="ml-auto inline-flex items-center rounded-full bg-white/10">
                                <button aria-label="5 minutes less" className="flex h-11 w-11 items-center justify-center" onClick={() => setMinutes((m) => Math.max(5, Number(m) - 5))} type="button"><Minus className="h-4 w-4"/></button>
                                <input
                                    aria-label="Minutes"
                                    className="w-12 bg-transparent text-center text-sm font-bold tabular-nums outline-none"
                                    inputMode="numeric"
                                    onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
                                    value={minutes}
                                />
                                <button aria-label="5 minutes more" className="flex h-11 w-11 items-center justify-center" onClick={() => setMinutes((m) => Number(m) + 5)} type="button"><Plus className="h-4 w-4"/></button>
                            </span>
                        </div>

                        <p className="t-pane mt-5 text-white/60">Intensity</p>
                        <div className="mt-2 grid grid-cols-4 gap-2">
                            {INTENSITIES.map((level) => (
                                <button
                                    aria-pressed={intensity === level.value}
                                    className={"min-h-[44px] rounded-full text-xs font-bold uppercase tracking-wide transition active:scale-95 " +
                                        level.className + (intensity === level.value ? " ring-2" : " opacity-60")}
                                    key={level.value}
                                    onClick={() => setIntensity(level.value)}
                                    type="button"
                                >
                                    {level.label}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                <button
                    aria-expanded={moreOpen}
                    className="mt-5 flex min-h-[44px] w-full items-center justify-between text-xs font-bold uppercase tracking-wide text-white/60"
                    onClick={() => setMoreOpen((v) => !v)}
                    type="button"
                >
                    <span>More{!moreOpen && ` · ${isSteps ? "date" : "when, kcal, distance"}`}</span>
                    <ChevronDown aria-hidden="true" className={"h-4 w-4 transition " + (moreOpen ? "rotate-180" : "")}/>
                </button>
                {moreOpen && (
                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="text-xs text-white/60">
                            {isSteps ? "Date" : "When"}
                            <input
                                className="mt-1 min-h-[44px] w-full rounded-2xl bg-white/10 px-3 text-sm text-white outline-none"
                                onChange={(e) => setStartAt(e.target.value)}
                                type={isSteps ? "date" : "datetime-local"}
                                value={isSteps ? startAt.substring(0, 10) : startAt}
                            />
                        </label>
                        {!isSteps && (
                            <>
                                <label className="text-xs text-white/60">
                                    Kcal
                                    <input className="mt-1 min-h-[44px] w-full rounded-2xl bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/30" inputMode="decimal" onChange={(e) => setKcal(e.target.value)} placeholder="Estimated" value={kcal}/>
                                </label>
                                <label className="text-xs text-white/60">
                                    Distance (km)
                                    <input className="mt-1 min-h-[44px] w-full rounded-2xl bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/30" inputMode="decimal" onChange={(e) => setDistance(e.target.value)} placeholder="Optional" value={distance}/>
                                </label>
                            </>
                        )}
                    </div>
                )}

                {error && <p className="mt-3 text-center text-xs italic text-danger-text" role="alert">{error}</p>}

                <button
                    className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-volt-400 text-base font-bold uppercase tracking-wide text-ink-950 shadow-glow-volt transition active:scale-[0.98] disabled:opacity-60"
                    disabled={isLoading}
                    onClick={save}
                    type="button"
                >
                    <SelectedIcon aria-hidden="true" className="h-5 w-5"/>
                    Save {sportLabel}{!isSteps && ` · ${minutes} min`}
                </button>
            </div>
        </Modal>
    );
}

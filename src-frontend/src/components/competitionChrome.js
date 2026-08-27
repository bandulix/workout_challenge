import React, {useEffect, useState} from "react";
import {useNavigate, useSearchParams} from "react-router-dom";
import {useDispatch} from "react-redux";
import {ChevronDown, DoorOpen, Megaphone, Settings, UserRoundPlus} from "lucide-react";
import {competitionsApi} from "../utils/reducers/competitionsSlice";
import {useLeaveCompetitionMutation} from "../utils/reducers/joinSlice";
import {useGetDrillConfigsQuery, useGetDrillMessagesQuery} from "../utils/reducers/drillInstructorSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import CompetitionForm from "../forms/competitionForm";
import CompetitionInviteModal from "../forms/shareModal";
import TransferOwnershipForm from "../forms/transferOwnershipForm";
import DrillInstructorConfigForm from "../forms/drillInstructorConfigForm";
import ActivityGoalsForm from "../forms/activityGoalsForm";
import {sportLabelShort} from "../forms/workoutForm";
import {PaneHead, paneCardClass} from "./uiBits";
import {topSportCounts} from "../utils/sportCounts";
import CoachThread from "./CoachThread";
import PhotoPost, {PhotoCamBonus} from "./PhotoPost";
import {ActivityReactProvider, ActivityStampButton, ActivityStampIcons} from "./ActivityReacts";
import {CoachHandover} from "./CoachVoteBox";
import PersonaAvatar from "./PersonaAvatar";
import ProfileAvatar from "./ProfileAvatar";
import {OrderRibbon} from "./gameBits";
import {OverlaySheet} from "../forms/basicComponents";
import {elapsedSince, timeAgo} from "../utils/time";
import {useProtectedImage} from "../utils/protectedMedia";
import usePollingInterval from "../utils/usePollingInterval";
import {confirmAction, notice} from "../utils/dialogs";

export function HeaderIconButton({onClick, title, icon: Icon, danger = false, isLoading = false}) {
    return (
        <button onClick={onClick} title={title} aria-label={title} disabled={isLoading}
                className={"p-2 rounded-full min-h-[40px] min-w-[40px] flex items-center justify-center transition active:scale-95 " +
                    (danger ? "text-gray-400 hover:text-red-500 hover:bg-red-500/10"
                            : "text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 hover:bg-ink-950/[0.05] dark:hover:bg-white/[0.06]")}>
            <Icon className={"h-5 w-5 " + (isLoading ? "animate-pulse" : "")}/>
        </button>
    );
}


function scoreGoals(goals, feed, userId, user) {
    if (!goals?.length || !userId) return [];
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const epochTimeToday = Math.floor(today.getTime() / 1000);
    const day = now.getDay();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((day + 6) % 7));
    lastMonday.setHours(0, 0, 0, 0);
    const epochTimeMonday = Math.floor(lastMonday.getTime() / 1000);
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    firstOfMonth.setHours(0, 0, 0, 0);
    const epochTimeMonth = Math.floor(firstOfMonth.getTime() / 1000);

    const list = Array.isArray(feed) ? feed : Object.values(feed || {});
    const mine = list.filter((item) => item.workout__user === userId);
    const byPeriod = {
        day: mine.filter((item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeToday),
        week: mine.filter((item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeMonday),
        month: mine.filter((item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeMonth),
    };

    return goals.map((goal) => {
        const filteredList = byPeriod[goal.period] || mine;
        let scaling = 1;
        if (["kcal", "kj"].includes(goal.metric)) scaling = user?.scaling_kcal ?? 1;
        else if (goal.metric === "km") scaling = user?.scaling_distance ?? 1;
        let points_capped = 0;
        for (const item of filteredList) {
            for (const detail of item.details || []) {
                if (detail.goal === goal.id) points_capped += Number(detail.points_capped) || 0;
            }
        }
        return {
            ...goal,
            goal: goal.goal * scaling,
            points_capped,
        };
    });
}


export function CompetitionHead({competition, feed, isOwner, goals, user}) {

    const [showEditCompetitionModal, setShowEditCompetitionModal] = useState(false);
    const [showInviteCompetitionModal, setShowInviteCompetitionModal] = useState(false);
    const [showTransferCompetitionModal, setShowTransferCompetitionModal] = useState(false);
    const [showDrillInstructorModal, setShowDrillInstructorModal] = useState(false);
    const [showModifyGoals, setShowModifyGoals] = useState(false);
    const [goalsOpen, setGoalsOpen] = useState(false);
    const pullStart = React.useRef(null);
    const scoredGoals = React.useMemo(
        () => scoreGoals(goals, feed, user?.id, user),
        [goals, feed, user],
    );
    const {total: countTotal, groups: countGroups} = React.useMemo(() => {
        const list = Object.values(feed || {}).filter((item) => item.workout !== null);
        return topSportCounts(list, "workout__sport_type");
    }, [feed]);

    const navigate = useNavigate();
    const dispatch = useDispatch();

    const [leaveCompetition, {
        isLoading: leaveIsLoading,
    }] = useLeaveCompetitionMutation();

    async function triggerLeaveCompetition() {
        const confirmation = await confirmAction('Are you sure you want to leave this challenge? Your earned points for yourself and your team will be unrecoverably deleted and you lose your spot on the leaderboard.');
        if (confirmation) {
            try {
                const data = await leaveCompetition(competition.id).unwrap();
                dispatch(competitionsApi.util.invalidateTags([{ type: 'Competition', id: competition.id }]));
                navigate('/dashboard');
            } catch (err) {
                console.error('Error leaving completion:', err);
                await notice('Error leaving competition. Please try again.');
            }

        }
    }



    const showGoals = scoredGoals.length > 0 || isOwner;

    function finishGoalsPull(event) {
        const start = pullStart.current;
        pullStart.current = null;
        if (!start) return;
        const dy = event.clientY - start.y;
        if (start.dragged && Math.abs(dy) > 24) setGoalsOpen(dy > 0);
        else if (!start.dragged) setGoalsOpen((v) => !v);
    }

    return (
        <div className="mb-4 rounded-3xl glass-card overflow-hidden">
            {/* Two-row header on small screens: the title gets the full
                width first (it used to truncate between the counts and
                the action buttons), counts + icon actions sit below. */}
            <div className="p-5 sm:p-6">
                <p className="text-xl font-display uppercase tracking-wide">{competition.name}</p>
                <p className="text-xs text-gray-500">{competition.start_date_fmt} - {competition.end_date_fmt}</p>
                <div className="mt-2.5 flex items-center gap-3">
                    <div className="flex items-baseline gap-1.5 shrink-0">
                        <span className="text-2xl font-display text-volt-500 dark:text-volt-400">{countTotal}</span>
                        <span className="uppercase text-[10px] tracking-wide text-gray-500">workouts</span>
                    </div>
                    {Object.entries(countGroups).map(([label, count], index) => (
                        <div key={"stat" + index} className="hidden lg:flex lg:flex-col lg:items-center shrink-0 px-1">
                            <span className="text-lg font-semibold leading-tight">{count}</span>
                            <span className="uppercase text-[10px] tracking-wide text-gray-500">{sportLabelShort(label)}</span>
                        </div>
                    ))}
                    <div className="flex items-center shrink-0 ml-auto">
                        {
                            (isOwner) ? <HeaderIconButton title="Settings" icon={Settings} onClick={() => setShowEditCompetitionModal(competition.id)}/> :
                                <HeaderIconButton title="Leave Competition" icon={DoorOpen} danger onClick={() => triggerLeaveCompetition()} isLoading={leaveIsLoading}/>
                        }
                        {isOwner && (
                            <HeaderIconButton title="AI Drill Instructor" icon={Megaphone} onClick={() => setShowDrillInstructorModal(true)}/>
                        )}
                        <HeaderIconButton title="Invite Others" icon={UserRoundPlus} onClick={() => setShowInviteCompetitionModal(true)}/>
                    </div>
                </div>
            </div>

            {showGoals && (
                <>
                    <button type="button"
                            aria-expanded={goalsOpen}
                            aria-label={goalsOpen ? "Hide challenge goals" : "Show challenge goals"}
                            onPointerDown={(e) => { pullStart.current = {y: e.clientY, dragged: false}; }}
                            onPointerMove={(e) => {
                                const start = pullStart.current;
                                if (!start) return;
                                if (Math.abs(e.clientY - start.y) > 8) start.dragged = true;
                            }}
                            onPointerUp={finishGoalsPull}
                            onPointerCancel={() => { pullStart.current = null; }}
                            className="w-full h-7 bg-volt-400 text-ink-950 flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(215,255,62,0.35)] active:brightness-95">
                        <span className="w-9 h-1 rounded-full bg-ink-950/30" aria-hidden="true"/>
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.18em]">Challenge goals</span>
                        <ChevronDown className={"h-3.5 w-3.5 transition-transform duration-200 " + (goalsOpen ? "rotate-180" : "")}/>
                    </button>
                    <div className={"grid transition-[grid-template-rows] duration-300 ease-out " +
                        (goalsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                        <div className="overflow-hidden">
                            <div className="px-5 sm:px-6 pb-5 pt-3">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Challenge goals</p>
                                    {isOwner && (
                                        <button type="button" onClick={() => setShowModifyGoals(true)}
                                                className="text-[11px] font-bold uppercase tracking-wide text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 transition min-h-[32px]">
                                            Edit
                                        </button>
                                    )}
                                </div>
                                {scoredGoals.length === 0 ? (
                                    <p className="text-xs text-gray-400">No challenge goals yet. Add targets so the field knows what to chase.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {scoredGoals.map((goal) => {
                                            const pct = Math.min(Math.max(Number(goal.points_capped) || 0, 0), 100);
                                            const complete = pct >= 100;
                                            const empty = pct <= 0;
                                            return (
                                                <div key={goal.id} className="rounded-2xl glass-inset px-3 py-2">
                                                    <div className="flex items-baseline justify-between gap-2">
                                                        <p className="text-sm font-semibold truncate">{goal.name}</p>
                                                        <p className="text-[11px] text-gray-400 shrink-0">
                                                            {Math.round(goal.goal).toLocaleString()} {goal.metric} / {goal.period}
                                                        </p>
                                                    </div>
                                                    <div className="mt-1.5 flex items-center gap-2">
                                                        <div className="flex-1 h-2 rounded-full bg-ink-950/10 dark:bg-white/10 overflow-hidden">
                                                            <div className={"h-full rounded-full transition-all " +
                                                                (empty ? "bg-ink-950/10 dark:bg-white/15" : complete ? "bg-volt-400" : "bg-gradient-to-r from-volt-600 to-volt-400")}
                                                                 style={{width: pct + "%"}}/>
                                                        </div>
                                                        <span className="text-[11px] font-extrabold text-volt-700 dark:text-volt-300 w-10 text-right">
                                                            {Math.round(pct)}P
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}

            {(showEditCompetitionModal) && <CompetitionForm setModalState={setShowEditCompetitionModal} setShowTransferCompetitionModal={setShowTransferCompetitionModal} competition={competition}/>}
            {(showInviteCompetitionModal) && <CompetitionInviteModal setModalState={setShowInviteCompetitionModal} competition={competition}/>}
            {(showTransferCompetitionModal) && <TransferOwnershipForm setModalState={setShowTransferCompetitionModal} competition={competition}/>}
            {(showDrillInstructorModal) && <DrillInstructorConfigForm competition={competition} setModalState={setShowDrillInstructorModal}/>}
            {showModifyGoals && (
                <ActivityGoalsForm setModalState={setShowModifyGoals} competitionId={competition.id}/>
            )}

        </div>
    )
}


// Challenge feed: independent glass cards on the gym plate. One visual
// language for workouts, photos, and coach announcements.
const FEED_WINDOW_MS = 48 * 60 * 60 * 1000;

const KIND_LABEL = {
    activity: "Workout",
    push: "Ping",
    nudge: "Nudge",
    photo: "Photo",
    order: "Order",
    test: "Preview",
    dunce: "Dunce",
    handover: "Handover",
    sigh: "Missed",
    echo: "Echo",
    claim: "Claimed",
    war: "War",
};

function dayLabel(iso) {
    if (!iso) return "";
    const then = new Date(iso);
    const now = new Date();
    const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
    const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((startNow - startThen) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return then.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        ...(then.getFullYear() !== now.getFullYear() ? {year: "numeric"} : {}),
    });
}

function groupByDay(list) {
    const groups = [];
    for (const m of list) {
        const label = dayLabel(m.posted_at);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(m);
        else groups.push({label, items: [m]});
    }
    return groups;
}

export function activityHasPhoto(message) {
    return (message.replies || []).some((r) => r.kind === "photo");
}

export function activityPhotoReply(message) {
    return (message.replies || []).find((r) => r.kind === "photo" && r.image) || null;
}

export function activityBackdropUrl(message) {
    // Only the coach's remixed poster is the card backdrop (and the
    // hot-or-not card). The original upload is the feed answer.
    const remix = (message.replies || []).find((r) => r.is_coach && r.image);
    return remix ? remix.image : null;
}

function activityTextReplies(message) {
    return (message.replies || []).filter(
        (r) => r.kind !== "photo" && !(r.is_coach && r.image),
    );
}

function FeedCard({children}) {
    return (
        <article className={paneCardClass}>
            {children}
        </article>
    );
}

function CoachSpeech({persona, children}) {
    if (!children) return null;
    return (
        <div className="flex items-start gap-2">
            <PersonaAvatar persona={persona} size={28} glow className="mt-0.5"/>
            <blockquote className="coach-quote coach-quote--inline relative min-w-0 flex-1 rounded-2xl px-3.5 py-2.5">
                <p className="relative text-[15px] leading-relaxed break-words">{children}</p>
            </blockquote>
        </div>
    );
}

const SPARK_GLYPHS = ["⋆", "·", "✦", "∗"];

const METRIC_TEXT = {
    min: {unit: "active minutes", of: (g) => `${g} active minutes`},
    num: {unit: "activities", of: (g) => `${g} ${g === "1" ? "activity" : "activities"}`},
    kcal: {unit: "kcal", of: (g) => `${g} kcal`},
    km: {unit: "km", of: (g) => `${g} km`},
    kj: {unit: "kJ", of: (g) => `${g} kJ`},
};

const PERIOD_TEXT = {
    day: "each day",
    week: "each week",
    month: "each month",
    year: "each year",
    competition: "over the whole challenge",
};

function plainNum(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "";
    if (Number.isInteger(x)) return String(x);
    return String(Math.round(x * 100) / 100);
}

function prettyNum(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "";
    if (Number.isInteger(x)) return x.toLocaleString();
    return (Math.round(x * 100) / 100).toLocaleString();
}

function factorBit(row) {
    const factor = Number(row.sport_factor);
    const factorTxt = Number.isFinite(factor) ? factor.toFixed(2) : "1.00";
    const sport = sportLabelShort(row.sport);
    return `activity factor (${factorTxt} from settings, ${sport})`;
}

function metricFormula(row) {
    const g = plainNum(row.target);
    if (!g) return null;
    const factor = factorBit(row);
    switch (row.metric) {
        case "min": {
            const m = row.minutes != null ? plainNum(row.minutes) : "—";
            return `points = active minutes (${m}) ÷ ${g} × 100 × ${factor}`;
        }
        case "num":
            return `points = 1 ÷ ${g} × 100 × ${factor}`;
        case "kcal": {
            const k = row.kcal != null ? prettyNum(row.kcal) : "—";
            const ef = Number(row.effort_factor);
            const eTxt = Number.isFinite(ef) ? ef.toFixed(2) : "1.00";
            return `points = kcal (${k}) ÷ (${g} × effort factor ${eTxt}) × 100 × ${factor}`;
        }
        case "km": {
            const d = row.km != null ? prettyNum(row.km) : "—";
            const df = Number(row.distance_factor);
            const dTxt = Number.isFinite(df) ? df.toFixed(2) : "1.00";
            return `points = km (${d}) ÷ (${g} × distance factor ${dTxt}) × 100 × ${factor}`;
        }
        case "kj": {
            const k = row.kcal != null ? prettyNum(row.kcal) : "—";
            const ef = Number(row.effort_factor);
            const eTxt = Number.isFinite(ef) ? ef.toFixed(2) : "1.00";
            return `points = kcal (${k}) × 4.18 ÷ (${g} × effort factor ${eTxt}) × 100 × ${factor}`;
        }
        default:
            return null;
    }
}

function capHitLine(row) {
    const hit = row.cap_hit;
    if (!hit) return null;
    const pts = Math.round(Number(hit.points != null ? hit.points : row.points) || 0);
    const unit = METRIC_TEXT[row.metric]?.unit ?? "";
    const limit = hit.limit != null ? ` of ${prettyNum(hit.limit)} ${unit}` : "";
    if (hit.kind === "day") {
        return `Capped at ${pts}P. You hit the daily limit${limit}.`;
    }
    if (hit.kind === "week") {
        return `Capped at ${pts}P. You hit the weekly limit${limit}.`;
    }
    if (hit.kind === "workout") {
        return `Capped at ${pts}P. You hit the per-workout limit${limit}.`;
    }
    if (hit.kind === "workout_min") {
        return `Counted ${pts}P. Below the per-workout minimum${limit}.`;
    }
    return `Capped at ${pts}P. A limit was hit.`;
}

function capLines(row) {
    const unit = METRIC_TEXT[row.metric]?.unit ?? "units";
    const lines = [];
    const push = (label, min, max) => {
        const parts = [];
        if (min != null && min !== "") parts.push(`nothing counts until ${prettyNum(min)} ${unit}`);
        if (max != null && max !== "") parts.push(`at most ${prettyNum(max)} ${unit} count`);
        if (parts.length) lines.push({label, text: parts.join("; ")});
    };
    push("This workout", row.min_per_workout, row.max_per_workout);
    push("Today", row.min_per_day, row.max_per_day);
    push("This week", row.min_per_week, row.max_per_week);
    return lines;
}

function pointsRowExplain(row) {
    if (row.kind === "photo") {
        const earned = Math.round(Number(row.points) || 0) > 0;
        return (
            <p className="mt-1 text-[14px] leading-snug text-gray-500 dark:text-gray-400">
                {earned ? "+10P for the picture. Caps do not apply." : "Add a picture for +10P. Caps do not apply."}
            </p>
        );
    }
    if (row.kind === "award") {
        return (
            <p className="mt-1 text-[14px] leading-snug text-gray-500 dark:text-gray-400">
                Bonus on top of the goals.
            </p>
        );
    }
    const metric = METRIC_TEXT[row.metric];
    const period = PERIOD_TEXT[row.period] || row.period;
    const target = prettyNum(row.target);
    const formula = metricFormula(row);
    const hit = capHitLine(row);
    const caps = capLines(row);
    const rawPts = Math.round(Number(row.raw) || 0);
    const counted = Math.round(Number(row.points) || 0);
    return (
        <div className="mt-1 space-y-1.5 text-[14px] leading-snug text-gray-500 dark:text-gray-400">
            {metric && target ? (
                <p>
                    Goal: {metric.of(target)} {period}. 100P if you hit it.
                </p>
            ) : (
                <p>Toward the {row.label} goal.</p>
            )}
            {formula && (
                <p className="font-mono text-[13px] leading-snug text-gray-600 dark:text-gray-400 break-words">
                    {formula}
                    {row.raw != null ? ` = ${rawPts}P before limits` : ""}
                </p>
            )}
            {hit ? (
                <p className="font-semibold text-gray-700 dark:text-gray-200">{hit}</p>
            ) : counted > 0 ? (
                <p>No cap. Full {counted}P counts.</p>
            ) : (
                <p>0P this session.</p>
            )}
            {!hit && caps.length > 0 && (
                <ul className="space-y-0.5">
                    {caps.map((line) => (
                        <li key={line.label}>
                            <b className="text-gray-600 dark:text-gray-300">{line.label}:</b> {line.text}
                        </li>
                    ))}
                </ul>
            )}
            {row.count_steps_as_walks === false && (
                <p>Step totals do not count.</p>
            )}
        </div>
    );
}

export function PointsChip({capped, raw, hasPhoto = false, size = "md", message = null}) {
    const [open, setOpen] = useState(false);
    if (capped == null) return null;
    const n = Math.max(0, Number(capped) || 0);
    const starred = raw != null && Number(capped) !== Number(raw);
    const t = Math.min(1, n / 100);
    const large = size === "lg";
    const sparkN = Math.max(1, Math.round(t * 7));
    const sparks = [];
    for (let i = 0; i < sparkN; i += 1) {
        sparks.push(
            <span
                key={i}
                className="points-spark"
                aria-hidden="true"
                style={{
                    "--sa": `${(360 / sparkN) * i}deg`,
                    "--sr": `${(large ? 20 : 16) + (i % 3) * 5 + t * 6}px`,
                    "--sd": `${2.8 - t * 1.2 + (i % 3) * 0.2}s`,
                    "--sdelay": `${-i * 0.22}s`,
                    "--ss": `${(large ? 6 : 5) + (i % 2)}px`,
                    "--hue": `${(i * 360) / sparkN}`,
                }}
            >
                <span>{SPARK_GLYPHS[i % SPARK_GLYPHS.length]}</span>
            </span>
        );
    }
    const breakdown = message?.points_breakdown || [];
    const addends = breakdown.filter((row) => Math.round(Number(row.points) || 0) !== 0);
    const summary = message?.workout_summary;
    const challenge = message?.competition_name;
    return (
        <>
            <button
                type="button"
                aria-label="How these points were calculated"
                onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                className={"points-chip-wrap relative inline-flex shrink-0 items-center justify-center p-3 -m-3 " +
                    (hasPhoto ? "points-chip-wrap--photo" : "")}>
                {sparks}
                <span
                    className="points-chip-bob relative z-[1] inline-flex flex-col items-center gap-0.5"
                    style={{
                        "--pg": `${12 + t * 28}px`,
                        "--pa": 0.22 + t * 0.5,
                        "--px": `${0.5 + t * 2.4}px`,
                        "--py": `${0.4 + t * 2}px`,
                        "--pr": `${0.4 + t * 2.4}deg`,
                        "--pd": `${2.6 - t * 1.15}s`,
                    }}
                >
                    <span className={"points-chip rounded-full text-ink-950 font-extrabold whitespace-nowrap tabular-nums leading-none " +
                        (large ? "text-[15px] px-3 py-1.5" : "text-[12px] px-2 py-0.5") + " " +
                        (hasPhoto ? "points-chip--photo" : "bg-volt-400")}>
                        +{Math.round(n).toLocaleString()}P{starred ? "*" : ""}
                    </span>
                    {hasPhoto && <PhotoCamBonus large={large}/>}
                </span>
            </button>
            {open && (
                <OverlaySheet title="How this score was made" onClose={() => setOpen(false)} zClass="z-[80]"
                              labelledBy="points-explain-title">
                    <div className="space-y-4 text-[15px] text-gray-700 dark:text-gray-300">
                        <p>
                            {summary ? <>{summary}</> : <>This workout</>}
                            {challenge ? <> · {challenge}</> : null}
                            {breakdown.length > 1 ? ". Goals add up. Photo is +10P." : "."}
                        </p>
                        {breakdown.length > 0 && (
                            <div className="rounded-2xl glass-well px-3 py-3">
                                {addends.length > 1 && (
                                    <p className="mb-3 flex flex-wrap items-baseline justify-center gap-y-1 text-center font-display text-[22px] leading-snug tabular-nums">
                                        {addends.map((row, i) => (
                                            <span key={i}>
                                                {i > 0 && (
                                                    <span className="mx-1.5 text-gray-400 dark:text-gray-500">+</span>
                                                )}
                                                <span className="text-ink-950 dark:text-white">
                                                    {Math.round(Number(row.points) || 0)}
                                                </span>
                                            </span>
                                        ))}
                                        <span className="mx-1.5 text-gray-400 dark:text-gray-500">=</span>
                                        <span className="text-volt-700 dark:text-volt-400">
                                            {Math.round(n).toLocaleString()}
                                        </span>
                                        <span className="ml-0.5 text-[13px] font-extrabold text-volt-700 dark:text-volt-400">P</span>
                                    </p>
                                )}
                                {breakdown.map((row, i) => (
                                    <div key={i}
                                         className={i === 0 ? "" : "mt-3 border-t border-ink-950/10 dark:border-white/10 pt-3"}>
                                        <div className="flex items-baseline gap-2">
                                            <span className="w-5 shrink-0 text-center font-display text-lg text-volt-700 dark:text-volt-400">
                                                {i === 0 ? "" : "+"}
                                            </span>
                                            <span className="min-w-0 flex-1 font-semibold">{row.label}</span>
                                            <span className="font-extrabold tabular-nums text-volt-700 dark:text-volt-400">
                                                {Math.round(Number(row.points) || 0)}P
                                                {row.raw != null && Number(row.points) !== Number(row.raw) ? "*" : ""}
                                            </span>
                                        </div>
                                        <div className="pl-7">{pointsRowExplain(row)}</div>
                                    </div>
                                ))}
                                <div className="mt-3 flex items-baseline gap-2 border-t-2 border-volt-400/50 pt-3">
                                    <span className="w-5 shrink-0 text-center font-display text-lg text-volt-700 dark:text-volt-400">=</span>
                                    <span className="min-w-0 flex-1 font-semibold">This workout</span>
                                    <span className="font-display text-xl tabular-nums leading-none text-volt-700 dark:text-volt-400">
                                        {Math.round(n).toLocaleString()}P
                                        {starred ? "*" : ""}
                                    </span>
                                </div>
                            </div>
                        )}
                        {starred && (
                            <p className="text-[14px] text-gray-500 dark:text-gray-400">
                                * A cap trimmed this. {Math.round(Number(raw) || 0)}P before limits, {Math.round(n)}P counted.
                            </p>
                        )}
                    </div>
                </OverlaySheet>
            )}
        </>
    );
}


function ActivityPhotoAnswer({src, reply, athleteName, onOpen}) {
    if (!src) return null;
    const who = reply.author_name || athleteName || "Athlete";
    return (
        <>
            <div className="flex justify-center">
                <ProfileAvatar
                    user={{profile_picture: reply.author_profile_picture, first_name: who}}
                    size={28}/>
            </div>
            <div className="min-w-0">
                <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
                        className="block w-full overflow-hidden rounded-2xl text-left focus:outline-none focus:ring-2 focus:ring-volt-400">
                    <img src={src} alt={reply.body || `${who}'s photo`}
                         className="max-h-72 w-full object-cover"/>
                </button>
            </div>
        </>
    );
}


export function ActivityCoachPost({message, persona, canReply, defaultOpen, competitionId, visionCapable, lastOwnActivityId, hero = false}) {
    const ownLatest = Boolean(canReply && lastOwnActivityId === message.id);
    const hasPhoto = activityHasPhoto(message);
    const original = activityPhotoReply(message);
    const remixUrl = activityBackdropUrl(message);
    const {src: bgSrc} = useProtectedImage(remixUrl);
    const {src: originalSrc} = useProtectedImage(original?.image);
    const [lightbox, setLightbox] = useState(null);
    const showThread = canReply || activityTextReplies(message).length > 0;
    const points = (
        <PointsChip capped={message.points_capped} raw={message.points_raw}
                    hasPhoto={hasPhoto} size={hero ? "lg" : "md"} message={message}/>
    );
    return (
        <ActivityReactProvider message={message}>
        <article
            className={"relative min-w-0 rounded-3xl text-ink-950 dark:text-white " +
                (bgSrc ? "border border-white/25 dark:border-white/10 cursor-pointer" : "glass-card")}
            onClick={bgSrc ? (e) => {
                if (e.target.closest("button, a, input, textarea, label")) return;
                setLightbox("remix");
            } : undefined}>
            {bgSrc && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl" aria-hidden="true">
                    <img src={bgSrc} alt=""
                         className="activity-photo-bg absolute inset-0 h-full w-full scale-105 object-cover"/>
                    <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/18 to-white/10 dark:from-ink-950/60 dark:via-ink-950/40 dark:to-ink-950/28"/>
                </div>
            )}
            {hero && (
                <div className="absolute -top-3.5 right-4 z-20 flex items-center gap-3">
                    <ActivityStampIcons/>
                    {points}
                </div>
            )}
            <div className="relative p-3.5 sm:p-4">
                <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-2.5 gap-y-3 items-start">
                <ProfileAvatar
                    user={{profile_picture: message.athlete_profile_picture, first_name: message.athlete_name}}
                    size={40}/>
                <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className={"flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 flex-1 " + (hero ? "pr-28" : "")}>
                            <div className="min-w-0">
                                <p className="font-semibold truncate leading-tight">{message.athlete_name || "Athlete"}</p>
                                <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                                    {message.workout_summary || "Workout"} · {timeAgo(message.posted_at)}
                                </p>
                            </div>
                            {ownLatest && !hasPhoto && (
                                <PhotoPost
                                    competitionId={competitionId}
                                    parentId={message.id}
                                    visionCapable={Boolean(visionCapable)}
                                    variant="ghost"
                                    label="Photo"
                                />
                            )}
                        </div>
                        {!hero && (
                            <div className="flex items-center gap-3 shrink-0">
                                <ActivityStampIcons/>
                                {points}
                            </div>
                        )}
                    </div>
                    {!!message.order_ribbon && (
                        <div className="mt-1.5">
                            <OrderRibbon show/>
                        </div>
                    )}
                </div>

                <div className="flex justify-center">
                    <PersonaAvatar persona={persona} size={28} glow/>
                </div>
                {message.body ? (
                    <blockquote className="coach-quote coach-quote--inline relative min-w-0 rounded-2xl px-3.5 py-2.5">
                        <p className="relative text-[15px] leading-relaxed break-words">{message.body}</p>
                    </blockquote>
                ) : <div/>}

                {original && (
                    <ActivityPhotoAnswer src={originalSrc} reply={original}
                                         athleteName={message.athlete_name}
                                         onOpen={() => setLightbox("original")}/>
                )}

                <>
                    <div aria-hidden="true"/>
                    {showThread ? (
                        <CoachThread message={message} persona={persona} canReply={canReply}
                                     defaultOpen={defaultOpen} className="mt-0"
                                     trailing={<ActivityStampButton/>}/>
                    ) : <ActivityStampButton/>}
                </>
                </div>
            </div>
            {lightbox === "remix" && bgSrc && (
                <OverlaySheet title="Roast" onClose={() => setLightbox(null)} zClass="z-[70]">
                    <img src={bgSrc} alt=""
                         className="mx-auto max-h-[70vh] w-full rounded-2xl object-contain"/>
                </OverlaySheet>
            )}
            {lightbox === "original" && originalSrc && (
                <OverlaySheet title={original?.author_name || message.athlete_name || "Photo"}
                              onClose={() => setLightbox(null)} zClass="z-[70]">
                    <img src={originalSrc} alt=""
                         className="mx-auto max-h-[70vh] w-full rounded-2xl object-contain"/>
                </OverlaySheet>
            )}
        </article>
        </ActivityReactProvider>
    );
}


function PhotoMessage({message, persona, canReply, defaultOpen, now}) {
    const {src} = useProtectedImage(message.image);
    const picturedReplies = (message.replies || []).some((r) => r.image);
    return (
        <article className="min-w-0 overflow-hidden rounded-3xl glass-card text-ink-950 dark:text-white">
            <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
                <ProfileAvatar
                    user={{profile_picture: message.author_profile_picture, first_name: message.author_name}}
                    size={36}/>
                <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate leading-tight">{message.author_name || "Participant"}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                        {timeAgo(message.posted_at)}
                        {picturedReplies && message.workout_summary ? ` · ${message.workout_summary}` : ""}
                    </p>
                </div>
            </div>
            {src && (
                <div className="relative bg-ink-950">
                    <img src={src} alt={message.body || `Shared by ${message.author_name || "a participant"}`}
                         className="w-full max-h-80 object-cover"/>
                    <span className="absolute bottom-2 right-2 rounded-full bg-ink-950/75 text-volt-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 tabular-nums">
                        {elapsedSince(message.posted_at, now)}
                    </span>
                </div>
            )}
            <div className="px-3.5 py-3">
                {message.body && (
                    <p className="text-[15px] leading-relaxed break-words">{message.body}</p>
                )}
                <CoachThread message={message} persona={persona} canReply={canReply} defaultOpen={defaultOpen}/>
            </div>
        </article>
    );
}


function AnnouncementPost({message, persona, canReply, defaultOpen}) {
    const kind = KIND_LABEL[message.kind] || "Coach";
    return (
        <FeedCard>
            <p className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-volt-700 dark:text-volt-400">
                    {kind}
                </span>
                <span className="text-[11px] text-gray-400">{timeAgo(message.posted_at)}</span>
            </p>
            <CoachSpeech persona={persona}>{message.body}</CoachSpeech>
            {message.athlete_name && (
                <p className="mt-2 pl-[36px] text-[11px] text-gray-400">→ {message.athlete_name}</p>
            )}
            <CoachThread message={message} persona={persona} canReply={canReply} defaultOpen={defaultOpen}/>
        </FeedCard>
    );
}


function OnDutyStrip({config, persona}) {
    const enabled = Boolean(config?.enabled);
    return (
        <div className="mb-3 flex items-center gap-2.5 px-1">
            <PersonaAvatar persona={persona} size={36} glow={enabled}/>
            <div className="min-w-0">
                <p className="font-display text-xs uppercase tracking-wider flex items-center gap-2">
                    <span className="truncate">{persona?.name || "Coach"}</span>
                    <span className={"inline-block h-2 w-2 rounded-full shrink-0 " +
                        (enabled ? "bg-volt-400 shadow-glow-volt" : "bg-gray-400")}
                          aria-hidden="true"/>
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {enabled ? "On duty" : "Benched"}
                </p>
            </div>
        </div>
    );
}


function DayRule({label}) {
    return <PaneHead title={label} />;
}


export function CoachCorner({competition, isOwner}) {
    // The Drill Instructor's presence on the competition page: latest
    // coach messages for this competition + a setup CTA for owners.
    const pollFast = usePollingInterval(60000);
    const {data: configs} = useGetDrillConfigsQuery();
    const config = (configs || []).find((c) => c.competition === competition.id) || null;
    const {data: messages} = useGetDrillMessagesQuery(
        {competition: competition.id},
        {pollingInterval: pollFast, skip: !config}
    );
    const {data: me} = useGetUserByIdQuery("me");
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showOlder, setShowOlder] = useState(false);
    const [now, setNow] = useState(Date.now());
    const cutoff = Date.now() - FEED_WINDOW_MS;

    // Deep link from the Coach page's "Respond" button
    // (/competition/<id>?reply=<messageId>): scroll Coach's Corner into
    // view and open the matching thread (defaultOpen below).
    const [searchParams] = useSearchParams();
    const replyTargetId = parseInt(searchParams.get("reply") || "", 10) || null;
    const cornerRef = React.useRef(null);
    useEffect(() => {
        if (replyTargetId && config && cornerRef.current) {
            cornerRef.current.scrollIntoView({behavior: "smooth", block: "start"});
        }
    }, [replyTargetId, config]);
    const picturedFeed = (messages || []).some((m) => m.image || (m.replies || []).some((r) => r.image));
    useEffect(() => {
        if (!picturedFeed) return undefined;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [picturedFeed]);
    useEffect(() => {
        if (!replyTargetId || !messages) return;
        const target = messages.find((m) => m.id === replyTargetId);
        if (target && new Date(target.posted_at).getTime() < Date.now() - FEED_WINDOW_MS) {
            setShowOlder(true);
        }
    }, [replyTargetId, messages]);

    if (!config) {
        if (!isOwner) return null;
        return (
            <div className="mb-4 relative overflow-hidden rounded-3xl glass-card text-ink-950 dark:text-white">
                <div className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-volt-400/25 blur-3xl"/>
                <div className="relative flex flex-wrap items-center gap-4 p-5">
                    <img src="/personas/megaphone.svg" alt="" className="h-14 w-14 rounded-full animate-float-slow shrink-0"/>
                    <div className="flex-1 min-w-0">
                        <p className="font-display text-sm uppercase tracking-wider">Unleash the Drill Instructor</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">An AI coach that comments on every workout - with push pings to keep everyone honest.</p>
                    </div>
                    <button onClick={() => setShowConfigModal(true)}
                            className="shrink-0 rounded-full bg-volt-400 text-ink-950 px-4 py-2.5 text-xs font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt">
                        Activate
                    </button>
                </div>
                {showConfigModal && <DrillInstructorConfigForm competition={competition} setModalState={setShowConfigModal}/>}
            </div>
        );
    }

    const persona = config.persona_detail || {};
    const all = messages || [];
    const recent = all.filter((m) => new Date(m.posted_at).getTime() >= cutoff);
    const older = all.filter((m) => new Date(m.posted_at).getTime() < cutoff);
    const visible = showOlder ? all : recent;
    const groups = groupByDay(visible);
    const lastOwnActivityId = all.find(
        (m) => m.kind === "activity" && m.workout_user_id === me?.id
    )?.id ?? null;

    function renderMessage(m) {
        const threadPersona = {
            avatar: m.persona_avatar,
            profile_picture: m.persona_profile_picture,
            theme_color: m.persona_theme_color,
            name: m.persona_name,
        };
        const canReply = Boolean(config.enabled && m.kind === "activity");
        const open = m.id === replyTargetId;
        if (m.kind === "photo") {
            return null;
        }
        if (m.kind === "activity") {
            return (
                <li key={m.id} className="min-w-0">
                    <ActivityCoachPost message={m} persona={threadPersona} canReply={canReply}
                                       defaultOpen={open}
                                       competitionId={competition.id}
                                       visionCapable={config.vision_capable}
                                       lastOwnActivityId={lastOwnActivityId}/>
                </li>
            );
        }
        return (
            <li key={m.id} className="min-w-0">
                <AnnouncementPost message={m} persona={threadPersona} canReply={canReply}
                                  defaultOpen={open}/>
            </li>
        );
    }

    return (
        <div ref={cornerRef} className="mb-4">
            <OnDutyStrip config={config} persona={persona}/>
            <CoachHandover configId={config.id} enabled={config.enabled}/>
            {all.length > 0 ? (
                <>
                    {visible.length === 0 && (
                        <p className="px-1 pb-3 text-sm text-gray-400">Quiet for 48 hours.</p>
                    )}
                    <div className="space-y-4">
                        {groups.map((g) => (
                            <section key={g.label}>
                                <DayRule label={g.label}/>
                                <ul className="space-y-3">
                                    {g.items.map(renderMessage)}
                                </ul>
                            </section>
                        ))}
                    </div>
                    {older.length > 0 && (
                        <button type="button" onClick={() => setShowOlder((v) => !v)}
                                className="mt-3 w-full min-h-[40px] text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400 hover:text-volt-700 dark:hover:text-volt-300 transition">
                            {showOlder ? "Show last 48 hours" : `${older.length} older`}
                        </button>
                    )}
                </>
            ) : (
                <article className="rounded-3xl glass-card px-5 py-6 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        No orders yet. Log a workout and the coach will have words.
                    </p>
                </article>
            )}
            {showConfigModal && <DrillInstructorConfigForm competition={competition} setModalState={setShowConfigModal}/>}
        </div>
    );
}


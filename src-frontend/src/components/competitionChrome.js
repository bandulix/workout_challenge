import React, {useEffect, useState} from "react";
import {useNavigate, useSearchParams} from "react-router-dom";
import {useDispatch} from "react-redux";
import {ChevronDown, DoorOpen, Info, Megaphone, Settings, UserRoundPlus} from "lucide-react";
import lodFilter from "lodash/filter";
import lodFlatmap from "lodash/flatMap";
import lodFrompairs from "lodash/fromPairs";
import lodGroupby from "lodash/groupBy";
import lodMapvalues from "lodash/mapValues";
import lodOrderby from "lodash/orderBy";
import lodSumby from "lodash/sumBy";
import lodTopairs from "lodash/toPairs";
import lodValues from "lodash/values";
import {competitionsApi} from "../utils/reducers/competitionsSlice";
import {useLeaveCompetitionMutation} from "../utils/reducers/joinSlice";
import {useGetDrillConfigsQuery, useGetDrillMessagesQuery} from "../utils/reducers/drillInstructorSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import CompetitionForm from "../forms/competitionForm";
import CompetitionInviteModal from "../forms/shareModal";
import TransferOwnershipForm from "../forms/transferOwnershipForm";
import DrillInstructorConfigForm from "../forms/drillInstructorConfigForm";
import PointsInfoModal from "./PointsInfo";
import ActivityGoalsForm from "../forms/activityGoalsForm";
import {sportLabelShort} from "../forms/workoutForm";
import CoachThread from "./CoachThread";
import {CoachHandover} from "./CoachVoteBox";
import PersonaAvatar from "./PersonaAvatar";
import ProfileAvatar from "./ProfileAvatar";
import {OrderRibbon} from "./gameBits";
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

    const mine = lodFilter(feed || [], (item) => item.workout__user === userId);
    const filteredDay = lodFilter(mine, (item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeToday);
    const filteredWeek = lodFilter(mine, (item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeMonday);
    const filteredMonth = lodFilter(mine, (item) => (item.workout__start_datetime_fmt?.epoch || 0) >= epochTimeMonth);

    return goals.map((goal) => {
        let filteredList = mine;
        if (goal.period === "day") filteredList = filteredDay;
        else if (goal.period === "week") filteredList = filteredWeek;
        else if (goal.period === "month") filteredList = filteredMonth;
        let scaling = 1;
        if (["kcal", "kj"].includes(goal.metric)) scaling = user?.scaling_kcal ?? 1;
        else if (goal.metric === "km") scaling = user?.scaling_distance ?? 1;
        const details = lodFlatmap(filteredList, "details").filter((item) => item.goal === goal.id);
        return {
            ...goal,
            goal: goal.goal * scaling,
            points_capped: lodSumby(details, "points_capped"),
        };
    });
}


export function CompetitionHead({competition, feed, isOwner, goals, user}) {

    const [showEditCompetitionModal, setShowEditCompetitionModal] = useState(false);
    const [showInviteCompetitionModal, setShowInviteCompetitionModal] = useState(false);
    const [showTransferCompetitionModal, setShowTransferCompetitionModal] = useState(false);
    const [showDrillInstructorModal, setShowDrillInstructorModal] = useState(false);
    const [showPointsInfoModal, setShowPointsInfoModal] = useState(false);
    const [showModifyGoals, setShowModifyGoals] = useState(false);
    const [goalsOpen, setGoalsOpen] = useState(false);
    const pullStart = React.useRef(null);
    const [countTotal, setCountTotal] = useState(0);
    const [countGroups, setCountGroups] = useState({});
    const scoredGoals = React.useMemo(
        () => scoreGoals(goals, feed, user?.id, user),
        [goals, feed, user],
    );

    useEffect(() => {
        const filteredFeed = lodFilter(lodValues(feed), item => item.workout !== null && item.workout__sport_type !== 'Steps');
        const totalCount = filteredFeed.length;
        setCountTotal(totalCount);
        const grouped = lodMapvalues(lodGroupby(lodValues(filteredFeed), 'workout__sport_type'), group => group.length);
        const sorted = lodFrompairs(lodOrderby(lodTopairs(grouped), ([, value]) => value, 'desc'));
        const limited = Object.fromEntries(Object.entries(sorted).slice(0, 4));
        setCountGroups(limited);
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
                        <HeaderIconButton title="How Points Work" icon={Info} onClick={() => setShowPointsInfoModal(true)}/>
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
            {(showPointsInfoModal) && <PointsInfoModal competition={competition} goals={goals} user={user} setModalState={setShowPointsInfoModal}/>}
            {showModifyGoals && (
                <ActivityGoalsForm setModalState={setShowModifyGoals} competitionId={competition.id}/>
            )}

        </div>
    )
}


// One photo post in the feed: the author's picture + caption bubble,
// then the thread (coach reaction + participant replies) underneath.
const FEED_WINDOW_MS = 48 * 60 * 60 * 1000;

function ActivityCoachPost({message, persona, canReply, defaultOpen, competitionId, visionCapable, lastOwnActivityId}) {
    const capped = message.points_capped;
    const raw = message.points_raw;
    const starred = capped != null && raw != null && Number(capped) !== Number(raw);
    return (
        <div className="min-w-0 flex-1 rounded-2xl glass-inset p-3 space-y-2.5">
            <div className="flex items-center gap-2.5">
                <ProfileAvatar
                    user={{profile_picture: message.athlete_profile_picture, first_name: message.athlete_name}}
                    size={40}/>
                <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate leading-tight">{message.athlete_name || "Athlete"}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {message.workout_summary || "Workout"} · {timeAgo(message.posted_at)}
                    </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <OrderRibbon show={!!message.order_ribbon}/>
                    {capped != null && (
                        <span className="rounded-full bg-volt-400 text-ink-950 text-[11px] font-extrabold px-2 py-0.5 shadow-glow-volt whitespace-nowrap">
                            +{Math.round(capped).toLocaleString()}P{starred ? "*" : ""}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-start gap-2">
                <PersonaAvatar persona={persona} size={28} glow/>
                <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug break-words dark:text-gray-100">{message.body}</p>
                    <CoachThread message={message} persona={persona} canReply={canReply} defaultOpen={defaultOpen}
                                 competitionId={competitionId} visionCapable={visionCapable}
                                 lastOwnActivityId={lastOwnActivityId}/>
                </div>
            </div>
        </div>
    );
}


function PhotoMessage({message, persona, canReply, defaultOpen, competitionId, visionCapable, lastOwnActivityId, now}) {
    const {src} = useProtectedImage(message.image);
    const picturedReplies = (message.replies || []).some((r) => r.image);
    return (
        <div className="min-w-0 flex-1">
            {src && (
                <img src={src} alt={message.body || `Shared by ${message.author_name || "a participant"}`}
                     className="max-h-72 w-auto max-w-full rounded-xl border border-gray-200/70 dark:border-ink-700/60"/>
            )}
            {src && (
                <p className="text-[10px] font-bold uppercase tracking-wider text-volt-700 dark:text-volt-400 mt-1">
                    elapsed {elapsedSince(message.posted_at, now)}
                </p>
            )}
            {message.body && (
                <p className="text-sm leading-snug break-words dark:text-gray-100 mt-1.5">{message.body}</p>
            )}
            <p className="text-[11px] text-gray-400 mt-0.5">
                {message.author_name || "Participant"} · {timeAgo(message.posted_at)}
                {picturedReplies && message.workout_summary ? ` · ${message.workout_summary}` : ""}
            </p>
            <CoachThread message={message} persona={persona} canReply={canReply} defaultOpen={defaultOpen}
                         competitionId={competitionId} visionCapable={visionCapable}
                         lastOwnActivityId={lastOwnActivityId}/>
        </div>
    );
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

    const all = messages || [];
    const recent = all.filter((m) => new Date(m.posted_at).getTime() >= cutoff);
    const older = all.filter((m) => new Date(m.posted_at).getTime() < cutoff);
    const visible = showOlder ? all : recent;
    const lastOwnActivityId = all.find(
        (m) => m.kind === "activity" && m.workout_user_id === me?.id
    )?.id ?? null;

    function renderMessage(m) {
        const threadPersona = {avatar: m.persona_avatar, profile_picture: m.persona_profile_picture, theme_color: m.persona_theme_color, name: m.persona_name};
        const picturedReplies = (m.replies || []).some((r) => r.image);
        const canReply = Boolean(config.enabled && m.kind === "activity");
        if (m.kind === "photo") {
            return (
                <li key={m.id} className="flex items-start gap-2 min-w-0">
                    <ProfileAvatar user={{profile_picture: m.author_profile_picture, first_name: m.author_name}} size={30}/>
                    <PhotoMessage message={m} persona={threadPersona} canReply={canReply}
                                  defaultOpen={m.id === replyTargetId}
                                  competitionId={competition.id}
                                  visionCapable={config.vision_capable}
                                  lastOwnActivityId={lastOwnActivityId}
                                  now={now}/>
                </li>
            );
        }
        if (m.kind === "activity") {
            return (
                <li key={m.id} className="min-w-0">
                    <ActivityCoachPost message={m} persona={threadPersona} canReply={canReply}
                                       defaultOpen={m.id === replyTargetId}
                                       competitionId={competition.id}
                                       visionCapable={config.vision_capable}
                                       lastOwnActivityId={lastOwnActivityId}/>
                </li>
            );
        }
        return (
            <li key={m.id} className="flex items-start gap-2 min-w-0">
                <PersonaAvatar persona={threadPersona} size={30}/>
                <div className="min-w-0 flex-1">
                    {/* break-words: long unbreakable strings (URLs, hashtag
                        chains from the LLM) must wrap instead of pushing
                        the page wider than the viewport. */}
                    {(m.kind === "echo" || m.kind === "claim" || m.kind === "war") && (
                        <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-volt-500">
                            {m.kind === "claim" ? "Echo claimed" : m.kind === "war" ? "Declared war" : "Legend Echo"}
                        </p>
                    )}
                    <p className="text-sm leading-snug break-words dark:text-gray-100">{m.body}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                        {m.athlete_name ? `→ ${m.athlete_name} · ` : ""}{timeAgo(m.posted_at)}
                        {picturedReplies && m.workout_summary ? ` · ${m.workout_summary}` : ""}
                    </p>
                    <CoachThread message={m} persona={threadPersona} canReply={canReply}
                                 defaultOpen={m.id === replyTargetId}
                                 competitionId={competition.id}
                                 visionCapable={config.vision_capable}
                                 lastOwnActivityId={lastOwnActivityId}/>
                </div>
                </li>
            );
    }

    return (
        <div ref={cornerRef} className="mb-4 rounded-3xl glass-card overflow-hidden">
            <CoachHandover configId={config.id} enabled={config.enabled}/>
            {all.length > 0 ? (
                <>
                    <ul className="px-3 sm:px-4 py-3 space-y-3">
                        {visible.map(renderMessage)}
                    </ul>
                    {recent.length === 0 && !showOlder && (
                        <p className="px-5 pb-3 text-sm text-gray-400">Nothing in the last 48 hours.</p>
                    )}
                    {older.length > 0 && (
                        <div className="px-3 sm:px-4 pb-3">
                            <button type="button" onClick={() => setShowOlder((v) => !v)}
                                    className="w-full min-h-[44px] rounded-2xl border border-volt-400/40 text-sm font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300 hover:bg-volt-400/10 transition">
                                {showOlder ? "Last 48 hours" : `${older.length} older ${older.length === 1 ? "message" : "messages"}`}
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <p className="px-5 py-4 text-sm text-gray-400">No orders yet - the coach speaks after the next logged workout.</p>
            )}
            {showConfigModal && <DrillInstructorConfigForm competition={competition} setModalState={setShowConfigModal}/>}
        </div>
    );
}


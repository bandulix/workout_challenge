import React, {useEffect, useState} from "react";
import {useNavigate, useSearchParams} from "react-router-dom";
import {useDispatch} from "react-redux";
import {DoorOpen, Info, Megaphone, Settings, UserRoundPlus} from "lucide-react";
import lodFilter from "lodash/filter";
import lodFrompairs from "lodash/fromPairs";
import lodGroupby from "lodash/groupBy";
import lodMapvalues from "lodash/mapValues";
import lodOrderby from "lodash/orderBy";
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
import {BoxSection} from "../utils/miscellaneous";
import {sportLabelShort} from "../forms/workoutForm";
import CoachThread from "./CoachThread";
import {CoachHandover} from "./CoachVoteBox";
import PersonaAvatar from "./PersonaAvatar";
import ProfileAvatar from "./ProfileAvatar";
import {elapsedSince, timeAgo} from "../utils/time";
import {useProtectedImage} from "../utils/protectedMedia";
import usePollingInterval from "../utils/usePollingInterval";
import {confirmAction, notice} from "../utils/dialogs";

export function HeaderIconButton({onClick, title, icon: Icon, danger = false, isLoading = false}) {
    return (
        <button onClick={onClick} title={title} aria-label={title} disabled={isLoading}
                className={"p-2 rounded-full min-h-[40px] min-w-[40px] flex items-center justify-center transition active:scale-95 " +
                    (danger ? "text-gray-400 hover:text-red-500 hover:bg-red-500/10"
                            : "text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 hover:bg-gray-100 dark:hover:bg-ink-800")}>
            <Icon className={"h-5 w-5 " + (isLoading ? "animate-pulse" : "")}/>
        </button>
    );
}


export function CompetitionHead({competition, feed, isOwner, goals, user}) {

    const [showEditCompetitionModal, setShowEditCompetitionModal] = useState(false);
    const [showInviteCompetitionModal, setShowInviteCompetitionModal] = useState(false);
    const [showTransferCompetitionModal, setShowTransferCompetitionModal] = useState(false);
    const [showDrillInstructorModal, setShowDrillInstructorModal] = useState(false);
    const [showPointsInfoModal, setShowPointsInfoModal] = useState(false);
    const [countTotal, setCountTotal] = useState(0);
    const [countGroups, setCountGroups] = useState({});

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



    return (
        <BoxSection additionalClasses="mb-4">
            {/* Two-row header on small screens: the title gets the full
                width first (it used to truncate between the counts and
                the action buttons), counts + icon actions sit below. */}
            <div className="px-1 sm:px-3">
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

            {(showEditCompetitionModal) && <CompetitionForm setModalState={setShowEditCompetitionModal} setShowTransferCompetitionModal={setShowTransferCompetitionModal} competition={competition}/>}
            {(showInviteCompetitionModal) && <CompetitionInviteModal setModalState={setShowInviteCompetitionModal} competition={competition}/>}
            {(showTransferCompetitionModal) && <TransferOwnershipForm setModalState={setShowTransferCompetitionModal} competition={competition}/>}
            {(showDrillInstructorModal) && <DrillInstructorConfigForm competition={competition} setModalState={setShowDrillInstructorModal}/>}
            {(showPointsInfoModal) && <PointsInfoModal competition={competition} goals={goals} user={user} setModalState={setShowPointsInfoModal}/>}

        </BoxSection>
    )
}


// One photo post in the feed: the author's picture + caption bubble,
// then the thread (coach reaction + participant replies) underneath.
const CORNER_PREVIEW = 3;

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
        const idx = messages.findIndex((m) => m.id === replyTargetId);
        if (idx >= CORNER_PREVIEW) setShowOlder(true);
    }, [replyTargetId, messages]);

    if (!config) {
        if (!isOwner) return null;
        return (
            <div className="mb-4 relative overflow-hidden rounded-3xl bg-white text-ink-950 border border-gray-300 shadow-card dark:bg-ink-900 dark:text-white dark:border-ink-700/60 dark:shadow-card-dark">
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
    const visible = showOlder ? all : all.slice(0, CORNER_PREVIEW);
    const older = Math.max(0, all.length - CORNER_PREVIEW);
    const lastOwnActivityId = all.find(
        (m) => m.kind === "activity" && m.workout_user_id === me?.id
    )?.id ?? null;

    function renderMessage(m) {
        const threadPersona = {avatar: m.persona_avatar, profile_picture: m.persona_profile_picture, theme_color: m.persona_theme_color, name: m.persona_name};
        const picturedReplies = (m.replies || []).some((r) => r.image);
        if (m.kind === "photo") {
            return (
                <li key={m.id} className="flex items-start gap-2 min-w-0">
                    <ProfileAvatar user={{profile_picture: m.author_profile_picture, first_name: m.author_name}} size={30}/>
                    <PhotoMessage message={m} persona={threadPersona} canReply={config.enabled}
                                  defaultOpen={m.id === replyTargetId}
                                  competitionId={competition.id}
                                  visionCapable={config.vision_capable}
                                  lastOwnActivityId={lastOwnActivityId}
                                  now={now}/>
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
                    <CoachThread message={m} persona={threadPersona} canReply={config.enabled}
                                 defaultOpen={m.id === replyTargetId}
                                 competitionId={competition.id}
                                 visionCapable={config.vision_capable}
                                 lastOwnActivityId={lastOwnActivityId}/>
                </div>
                </li>
            );
    }

    return (
        <div ref={cornerRef} className="mb-4 rounded-3xl bg-white border border-gray-300 dark:bg-ink-850 dark:border-ink-700/60 shadow-card dark:shadow-card-dark overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-gray-200 dark:border-ink-700/60">
                <PersonaAvatar persona={persona} size={44} glow={config.enabled}/>
                <div className="flex-1 min-w-0">
                    <p className="font-display text-xs uppercase tracking-wider flex items-center gap-2">
                        Coach's Corner
                        <span className={"inline-block h-2 w-2 rounded-full " + (config.enabled ? "bg-volt-500 animate-pulse" : "bg-gray-300")}/>
                    </p>
                    <p className="text-xs text-gray-400 break-words">
                        {persona.name}{config.enabled ? " is on duty" : " is benched"} · {config.messages_posted || 0} messages
                    </p>
                </div>
                {isOwner && (
                    <button onClick={() => setShowConfigModal(true)}
                            className="text-[11px] font-bold uppercase tracking-wide text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 transition">
                        Configure
                    </button>
                )}
            </div>
            <CoachHandover configId={config.id} enabled={config.enabled}/>
            {all.length > 0 ? (
                <>
                    <ul className="px-3 sm:px-4 py-3 space-y-3">
                        {visible.map(renderMessage)}
                    </ul>
                    {older > 0 && (
                        <div className="px-3 sm:px-4 pb-3">
                            <button type="button" onClick={() => setShowOlder((v) => !v)}
                                    className="w-full min-h-[44px] rounded-2xl border border-volt-400/40 text-sm font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300 hover:bg-volt-400/10 transition">
                                {showOlder ? "Show latest" : `${older} older ${older === 1 ? "message" : "messages"}`}
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


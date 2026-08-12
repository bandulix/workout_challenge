import {useNavigate, useNavigationType, useParams, useSearchParams} from 'react-router-dom';
import React, {useEffect, useState} from "react";
import {competitionsApi, useGetCompetitionByIdQuery} from "../utils/reducers/competitionsSlice";
import {
    ArrowDownToLine,
    ArrowUpToLine,
    Camera,
    DoorOpen,
    Info,
    Megaphone,
    Send,
    Settings,
    UserRoundPlus,
    UsersRound,
    X,
} from "lucide-react";
import {Bar, Line} from 'react-chartjs-2';
import {
    Chart as ChartJS,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    LineElement,
    PointElement,
    Filler,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import {statsApi, useGetStatsByIdQuery} from "../utils/reducers/statsSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import lodFilter from 'lodash/filter';
import lodFlatmap from 'lodash/flatMap';
import lodFrompairs from 'lodash/fromPairs';
import lodGroupby from 'lodash/groupBy';
import lodMapvalues from 'lodash/mapValues';
import lodOrderby from 'lodash/orderBy';
import lodSumby from 'lodash/sumBy';
import lodTopairs from 'lodash/toPairs';
import lodValues from 'lodash/values';
import {SectionLoader} from "../utils/loaders";
import {useGetFeedByIdQuery} from "../utils/reducers/feedSlice";
import CompetitionForm from "../forms/competitionForm";
import JoinTeamForm from "../forms/joinTeamForm";
import ActivityGoalsForm from "../forms/activityGoalsForm";
import {
    ChangeTeamButton,
    ModifyGoalsButton,
    StravaButton,
} from "../forms/basicComponents";
import {BoxSection, ErrorBoxSection, PageWrapper, useDarkMode} from "../utils/miscellaneous";
import {sportLabelShort} from "../forms/workoutForm";
import CoachThread from "../components/CoachThread";
import CompetitionInviteModal from "../forms/shareModal";
import {useDispatch} from "react-redux";
import {useLeaveCompetitionMutation} from "../utils/reducers/joinSlice";
import TransferOwnershipForm from "../forms/transferOwnershipForm";
import {teamsApi} from "../utils/reducers/teamsSlice";
import DrillInstructorConfigForm from "../forms/drillInstructorConfigForm";
import {drillInstructorApi, useGetDrillConfigsQuery, useGetDrillMessagesQuery, usePostDrillPhotoMutation} from "../utils/reducers/drillInstructorSlice";
import PersonaAvatar from "../components/PersonaAvatar";
import PointsInfoModal from "../components/PointsInfo";
import ProfileAvatar from "../components/ProfileAvatar";
import {timeAgo} from "../utils/time";
import {compressImage} from "../utils/imageCompress";
import {useProtectedImage} from "../utils/protectedMedia";
import {BeatLoader} from "react-spinners";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip, Legend, BarElement, ChartDataLabels);


function HeaderIconButton({onClick, title, icon: Icon, danger = false, isLoading = false}) {
    return (
        <button onClick={onClick} title={title} aria-label={title} disabled={isLoading}
                className={"p-2 rounded-full min-h-[40px] min-w-[40px] flex items-center justify-center transition active:scale-95 " +
                    (danger ? "text-gray-400 hover:text-red-500 hover:bg-red-500/10"
                            : "text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 hover:bg-gray-100 dark:hover:bg-ink-800")}>
            <Icon className={"h-5 w-5 " + (isLoading ? "animate-pulse" : "")}/>
        </button>
    );
}


function CompetitionHead({competition, feed, isOwner, goals, user}) {

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
        const confirmation = window.confirm('Are you sure you want to leave the competition? Your earned points for yourself and your team will be unrecoverably deleted and you loose your spot on the leaderboard.');
        if (confirmation) {
            try {
                const data = await leaveCompetition(competition.id).unwrap();
                console.log('Successfully left competition:', data);
                dispatch(competitionsApi.util.invalidateTags([{ type: 'Competition', id: competition.id }]));
                navigate('/dashboard');
            } catch (err) {
                console.error('Error leaving completion:', err);
                window.alert('Error leaving competition. Please try again.');
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


// Photo sharing for the coach feed: pick (or take, on mobile) a
// picture, it gets compressed before upload (see utils/imageCompress.js),
// then posted as a thread root - the coach reacts, participants reply
// through the regular thread UI.
function PhotoComposer({competitionId}) {
    const fileInput = React.useRef(null);
    const [file, setFile] = useState(null);
    const [caption, setCaption] = useState("");
    const [error, setError] = useState(null);
    const [posting, setPosting] = useState(false);
    const [postPhoto] = usePostDrillPhotoMutation();
    const dispatch = useDispatch();

    // Local preview of the picked file (instant, no upload needed).
    const [preview, setPreview] = useState(null);
    useEffect(() => {
        if (!file) {
            setPreview(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    function reset() {
        setFile(null);
        setCaption("");
        setError(null);
    }

    async function handleSend() {
        if (!file || posting) return;
        setError(null);
        setPosting(true);
        try {
            const compressed = await compressImage(file);
            await postPhoto({competition: competitionId, image: compressed, caption: caption.trim()}).unwrap();
            reset();
            // The coach's reaction is generated asynchronously (usually a
            // few seconds) - two delayed re-fetches pick it up quickly,
            // the regular 60s poll is the backstop.
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage'])), 8000);
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage'])), 20000);
        } catch (err) {
            const data = err?.data || {};
            setError(data.image || data.caption || data.competition || "Could not post your picture - please try again.");
        } finally {
            setPosting(false);
        }
    }

    if (!file) {
        return (
            <>
                <input ref={fileInput} type="file" accept="image/*" className="hidden"
                       onChange={(e) => { setError(null); setFile(e.target.files?.[0] || null); e.target.value = ""; }}/>
                <button onClick={() => fileInput.current?.click()}
                        title="Share a photo"
                        aria-label="Share a photo"
                        className="shrink-0 min-h-[36px] min-w-[36px] rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 transition shadow-glow-volt flex items-center justify-center">
                    <Camera className="h-4 w-4"/>
                </button>
            </>
        );
    }

    return (
        <div className="px-5 py-3 border-t border-gray-100 dark:border-ink-700/60 space-y-2">
            <div className="relative inline-block">
                <img src={preview} alt="Upload preview"
                     className="max-h-48 rounded-xl border border-gray-200/70 dark:border-ink-700/60"/>
                <button onClick={reset} aria-label="Discard photo"
                        className="absolute -top-2 -right-2 min-h-[28px] min-w-[28px] rounded-full bg-ink-900 text-white flex items-center justify-center hover:bg-ink-700 transition">
                    <X className="h-3.5 w-3.5"/>
                </button>
            </div>
            <div className="flex items-center gap-2">
                <input type="text" value={caption} maxLength={500}
                       onChange={(e) => setCaption(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                       placeholder="Add a caption…"
                       aria-label="Photo caption"
                       className="flex-1 shadow border border-gray-200 dark:border-ink-700/60 rounded-full py-2 px-4 text-sm text-gray-700 dark:bg-ink-900 dark:text-gray-300 dark:placeholder-gray-600 leading-tight focus:outline-none focus:border-volt-500"/>
                <button onClick={handleSend} disabled={posting}
                        aria-label="Post photo"
                        className="shrink-0 min-h-[44px] min-w-[44px] rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none flex items-center justify-center">
                    {posting ? <BeatLoader size={5} color="#0a0d06"/> : <Send className="h-4 w-4"/>}
                </button>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}


// One photo post in the feed: the author's picture + caption bubble,
// then the thread (coach reaction + participant replies) underneath.
function PhotoMessage({message, persona, canReply, defaultOpen}) {
    const {src} = useProtectedImage(message.image);
    return (
        <div className="min-w-0 flex-1">
            {src && (
                <img src={src} alt={message.body || `Shared by ${message.author_name || "a participant"}`}
                     className="max-h-72 w-auto max-w-full rounded-xl border border-gray-200/70 dark:border-ink-700/60"/>
            )}
            {message.body && (
                <p className="text-sm leading-snug break-words dark:text-gray-100 mt-1.5">{message.body}</p>
            )}
            <p className="text-[11px] text-gray-400 mt-0.5">
                {message.author_name || "Participant"} · {timeAgo(message.posted_at)}
            </p>
            <CoachThread message={message} persona={persona} canReply={canReply} defaultOpen={defaultOpen}/>
        </div>
    );
}


function CoachCorner({competition, isOwner}) {
    // The Drill Instructor's presence on the competition page: latest
    // coach messages for this competition + a setup CTA for owners.
    const {data: configs} = useGetDrillConfigsQuery();
    const config = (configs || []).find((c) => c.competition === competition.id) || null;
    const {data: messages} = useGetDrillMessagesQuery(
        {competition: competition.id},
        {pollingInterval: 60000, skip: !config}
    );
    const [showConfigModal, setShowConfigModal] = useState(false);

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

    if (!config) {
        if (!isOwner) return null;
        return (
            <div className="mb-4 relative overflow-hidden rounded-3xl bg-ink-900 text-white border border-ink-700/60 shadow-card-dark">
                <div className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-volt-400/25 blur-3xl"/>
                <div className="relative flex items-center gap-4 p-5">
                    <img src="/personas/megaphone.svg" alt="" className="h-14 w-14 rounded-full animate-float-slow"/>
                    <div className="flex-1 min-w-0">
                        <p className="font-display text-sm uppercase tracking-wider">Unleash the Drill Instructor</p>
                        <p className="text-xs text-gray-400 mt-0.5">An AI coach that comments on every workout - with push pings to keep everyone honest.</p>
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
    const latest = (messages || []).slice(0, 3);

    return (
        <div ref={cornerRef} className="mb-4 rounded-3xl bg-white dark:bg-ink-850 dark:border dark:border-ink-700/60 shadow-card dark:shadow-card-dark overflow-hidden">
            <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-ink-700/60">
                <PersonaAvatar persona={persona} size={44} glow={config.enabled}/>
                <div className="flex-1 min-w-0">
                    <p className="font-display text-xs uppercase tracking-wider flex items-center gap-2">
                        Coach's Corner
                        <span className={"inline-block h-2 w-2 rounded-full " + (config.enabled ? "bg-volt-500 animate-pulse" : "bg-gray-300")}/>
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                        {persona.name}{config.enabled ? " is on duty" : " is benched"} · {config.messages_posted || 0} messages
                    </p>
                </div>
                {/* Photo posts need two things: the coach on duty (same
                    gate as thread replies) and a vision-capable AI model
                    (probed server-side) - a coach that can't see pictures
                    doesn't offer the camera. */}
                {config.enabled && config.vision_capable && <PhotoComposer competitionId={competition.id}/>}
                {isOwner && (
                    <button onClick={() => setShowConfigModal(true)}
                            className="text-[11px] font-bold uppercase tracking-wide text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 transition">
                        Configure
                    </button>
                )}
            </div>
            {latest.length > 0 ? (
                <ul className="px-4 py-3 space-y-3">
                    {latest.map((m) => {
                        const threadPersona = {avatar: m.persona_avatar, profile_picture: m.persona_profile_picture, theme_color: m.persona_theme_color, name: m.persona_name};
                        if (m.kind === "photo") {
                            return (
                                <li key={m.id} className="flex items-start gap-2.5">
                                    <ProfileAvatar user={{profile_picture: m.author_profile_picture, first_name: m.author_name}} size={30}/>
                                    <PhotoMessage message={m} persona={threadPersona} canReply={config.enabled} defaultOpen={m.id === replyTargetId}/>
                                </li>
                            );
                        }
                        return (
                            <li key={m.id} className="flex items-start gap-2.5">
                                <PersonaAvatar persona={threadPersona} size={30}/>
                                <div className="min-w-0 flex-1">
                                    {/* break-words: long unbreakable strings (URLs, hashtag
                                        chains from the LLM) must wrap instead of pushing
                                        the page wider than the viewport. */}
                                    <p className="text-sm leading-snug break-words dark:text-gray-100">{m.body}</p>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                        {m.athlete_name ? `→ ${m.athlete_name} · ` : ""}{timeAgo(m.posted_at)}
                                    </p>
                                    <CoachThread message={m} persona={threadPersona} canReply={config.enabled} defaultOpen={m.id === replyTargetId}/>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p className="px-5 py-4 text-sm text-gray-400">No orders yet - the coach speaks after the next logged workout.</p>
            )}
            {showConfigModal && <DrillInstructorConfigForm competition={competition} setModalState={setShowConfigModal}/>}
        </div>
    );
}


function ChartThisWeek({history}) {
    const isDarkMode = useDarkMode();
    // Memoized: without it react-chartjs-2 re-processes data+options on
    // every poll tick even though nothing changed.
    const data = React.useMemo(() => ({
        labels: history['Legend'],
        datasets: [
            {
                label: 'Me',
                data: history['Me'],
                backgroundColor: '#b8e62e',
                borderRadius: 5,
                clip: false,
            },
            {
                label: 'My Team',
                data: history['My Team'],
                backgroundColor: 'rgb(75, 192, 192)',
                borderRadius: 5,
                clip: false,
                hidden: true,
            },
            {
                label: 'Average',
                data: history['Average'],
                backgroundColor: 'rgb(156, 163, 175)',
                borderRadius: 5,
                clip: false,
                hidden: true,
            },
        ],
    }), [history, isDarkMode]);

    const options = React.useMemo(() => ({
        scales: {
            x: {
                display: true,
                ticks: {display: true},
                grid: {display: false},
            },
            y: {display: false},
        },
        layout: {
            padding: {
                top: 30, // Adjust as needed
            },
        },
        plugins: {
            legend: {
                display: true,
                position: 'bottom', // move legend to bottom
                labels: {
                    boxWidth: 12,
                    padding: 20,
                },
            },
            tooltip: false,
            datalabels: {
                anchor: 'end',
                align: 'end',
                color: isDarkMode ? '#fff' : '#000',
                font: {weight: 'bold'},
            },
        },
    }), [isDarkMode]);

    return (
        <Bar data={data} options={options} plugins={[ChartDataLabels]}/>
    )
}


function ChartHistory({history}) {
    const data = React.useMemo(() => ({
        labels: history['Legend'],
        datasets: [
            {
                label: 'Me',
                data: history['Me'],
                borderColor: '#b8e62e',
                tension: 0.3, // slight smoothing
                fill: false,
                spanGaps: true,
            },
            {
                label: 'My Team',
                data: history['My Team'],
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.3, // slight smoothing
                fill: false,
                spanGaps: true,
            },
            {
                label: 'Average',
                data: history['Average'],
                borderColor: 'rgb(156, 163, 175)',
                tension: 0.3, // slight smoothing
                fill: false,
                spanGaps: true,
            },
        ],
    }), [history]);

    const options = React.useMemo(() => ({
        scales: {
            x: {display: false},
            y: {
                display: true,
                position: 'right',
                grid: {display: false},
                ticks: {
                    padding: 10,
                    color: '#666',
                },
            },
        },
        layout: {
            padding: {
                left: 20,
                right: 5,
                top: 10,
            },
        },
        plugins: {
            legend: {
                display: true,
                position: 'bottom', // move legend to bottom
                labels: {
                    boxWidth: 12,
                    padding: 20,
                },
            },
            datalabels: {display: false},
        },
    }), []);
    return (
        <Line data={data} options={options}/>
    )
}



function TeamLeaderboardBox({stats, competition, user, teamId, isOwner}) {
    const dispatch = useDispatch();

    const [showChangeTeamModal, setShowChangeTeamModal] = useState(false);
    function setShowChangeTeamModalMiddleware(state) {
        if (state === false) {
            dispatch(statsApi.util.invalidateTags([{ type: 'Stats', id: competition.id }]));
        }
        setShowChangeTeamModal(state);
    }

    return (
        <>
            <BoxSection>
                <div className="flex flex-col items-center justify-between sm:flex-row sm:items-center border-b border-gray-200/70 dark:border-ink-700/60 pb-3">
                    <span className="mx-4 text-gray-500 uppercase font-bold">Team Leaderboard</span>
                    {(!competition.organizer_assigns_teams || isOwner) && (
                        <div className="p-0 mt-2.5 sm:mt-0">
                            <ChangeTeamButton onClick={() => setShowChangeTeamModalMiddleware(true)} larger={false}/>
                        </div>
                    )}
                </div>


                <table className="min-w-full my-2">
                    <tbody>
                    {(stats.leaderboard.team.length === 0) ? (
                        <tr className="hover:bg-gray-100 dark:hover:bg-ink-800 border-b">
                            <td className="py-2 px-4 pb-3 text-center text-gray-500">Create the first team!
                            </td>
                        </tr>
                    ) : (
                        stats.leaderboard.team.map((team, index) => (
                            <tr key={team.workout__user__my_teams__id}
                                className={((parseInt(teamId) === team.workout__user__my_teams__id) ? "bg-volt-400/10 dark:bg-volt-400/5 " : "") + "hover:bg-gray-100 dark:hover:bg-ink-800 border-b"}>
                                <td className="py-2 px-2">
                                    <span className="font-semibold">#{team.rank}</span>
                                </td>
                                <td className="py-2 px-2">
                                    <span className="font-semibold">{team.name}</span>
                                </td>
                                <td className="py-2 px-2 group relative inline-block cursor-pointer">
                                <span className="text-sm text-gray-500 flex items-center gap-1">
                                    <UsersRound className="h-3.5 w-3.5"/> {team.members.length}
                                </span>
                                    <div
                                        className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 p-2 bg-white dark:bg-gray-800 border dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto z-10">
                                        <p className="text-sm font-semibold">Members:</p>
                                        <ul className="text-sm list-disc pl-5">
                                            {team.members.map((user, usr_index) => (
                                                <li key={"leader_user" + usr_index}>{user.username} {Math.round(user.total_capped, 0).toLocaleString()}P</li>
                                            ))}
                                        </ul>

                                    </div>
                                </td>
                                <td className="py-2 px-2 text-right">
                                <span
                                    className="font-semibold">{Math.round(team.total_capped, 0).toLocaleString()}P</span>
                                </td>
                            </tr>
                        ))
                    )}
                    </tbody>
                </table>
                {(competition.organizer_assigns_teams) ? <div className="pt-1 w-full text-center text-sm text-gray-500 italic"><b>Note:</b> The organizer assigns teams!</div> : null}
            </BoxSection>

            {(showChangeTeamModal) && <JoinTeamForm setModalState={setShowChangeTeamModalMiddleware} competition={competition} user={user} isOwner={isOwner}/>}

        </>
    )
}

const RANK_STYLES = {
    1: "text-yellow-500 dark:text-yellow-400",   // gold
    2: "text-gray-400 dark:text-gray-300",       // silver
    3: "text-amber-600 dark:text-amber-500",     // bronze
};

function IndividualLeaderboardBox({stats, userId}) {

    return (
        <BoxSection>
            <div className="flex flex-col items-center justify-between sm:flex-row sm:items-center border-b border-gray-200/70 dark:border-ink-700/60 pb-3">
                <span className="mx-4 text-gray-500 uppercase font-bold">Leaderboard</span>
            </div>

            {(stats.leaderboard.individual.length === 0) ? (
                <p className="py-4 px-4 text-center text-gray-500">Here participants will show up!</p>
            ) : (
                <ul className="my-1">
                    {stats.leaderboard.individual.map((person, index) => (
                        <li key={person.workout__user__id}
                            className={"flex items-center gap-3 px-3 py-2.5 " + ((userId === person.workout__user__id) ? "bg-volt-400/10 dark:bg-volt-400/5 " : "")}>
                            {/* Rank - medal colours for the podium */}
                            <span className={"w-8 shrink-0 text-center font-display text-lg " + (RANK_STYLES[person.rank] || "text-gray-400")}>
                                {person.rank !== null ? `#${person.rank}` : "–"}
                            </span>

                            {/* Profile picture with the points badge hovering
                                partly over its bottom-right corner */}
                            <div className="relative shrink-0 mr-1.5">
                                <ProfileAvatar user={person} size={46}/>
                                <span className="absolute -bottom-1 -right-2 rounded-full bg-volt-400 text-ink-950 text-[10px] font-extrabold px-1.5 py-0.5 shadow-glow-volt whitespace-nowrap">
                                    {Math.round(person.total_capped ?? 0).toLocaleString()}P
                                </span>
                            </div>

                            <div className="min-w-0 flex-1">
                                <p className="font-semibold truncate">{person.username}</p>
                                {(person.rank !== null && person.days_on_rank > 0) && (
                                    <p className="text-[11px] text-gray-400">
                                        on #{person.rank} for {person.days_on_rank} {person.days_on_rank === 1 ? "day" : "days"}
                                    </p>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </BoxSection>
    )
}


function FeedBox({feed}) {

    return (
        <BoxSection>

            <div className="flex flex-col items-center justify-between sm:flex-row sm:items-center border-b border-gray-200/70 dark:border-ink-700/60 pb-3">
                <span className="mx-4 text-gray-500 uppercase font-bold">Activity Feed</span>
            </div>

            <table className="min-w-full my-2">
                <tbody>
                {(feed.length === 0) ? (
                    <tr className="hover:bg-gray-100 dark:hover:bg-ink-800 border-b">
                        <td className="py-2 px-4 pb-3 text-center text-gray-500">Here participants' activities will show
                            up!
                        </td>
                    </tr>
                ) : (feed.map((entry, index) => {
                        return (
                            <tr key={entry.workout} className="hover:bg-gray-100 dark:hover:bg-ink-800 border-b">
                                <td className="py-2 px-4 text-sm md:text-base">
                                    <span className="font-semibold">{entry.workout__start_datetime_fmt.date_readable}</span><br/>
                                    <span className="text-sm hidden sm:block">{entry.workout__start_datetime_fmt.time_24h}</span>
                                </td>
                                <td className="py-2 px-4 block md:table-cell">
                                    {/* Mobile view (stacked) */}
                                    <div className="md:hidden">
                                        <div className="font-medium">{entry.workout__user__username}</div>
                                        <div className="text-sm text-gray-600 dark:text-gray-400">{(entry.workout__sport_type === "Steps") ? entry.workout__steps?.toLocaleString() : Math.round(parseFloat(entry.workout__duration) / 60, 0).toLocaleString() + "min"}<span className="font-semibold"> {sportLabelShort(entry.workout__sport_type)}</span></div>
                                    </div>
                                    {/* Desktop view (normal) */}
                                    <div className="hidden md:block">{entry.workout__user__username}</div>
                                </td>
                                <td className="py-2 px-4 hidden md:table-cell">{(entry.workout__sport_type === "Steps") ? entry.workout__steps?.toLocaleString() : Math.round(parseFloat(entry.workout__duration) / 60, 0).toLocaleString() + "min"}<span
                                    className="font-semibold"> {sportLabelShort(entry.workout__sport_type)}</span>
                                </td>
                                <td className="py-2 px-0 sm:px-4">
                                    {(entry.workout__user__strava_allow_follow && entry.workout__strava_id) ? (
                                        <StravaButton label={"Like Activity"} additionalClasses={"hidden sm:flex"}
                                                      onClick={() => {
                                                          // Coerce to string and strip anything that isn't a digit
                                                          // so a poisoned strava_id (e.g. "../../evil") can't
                                                          // turn the click into an open redirect.
                                                          const id = String(entry.workout__strava_id).replace(/[^0-9]/g, '');
                                                          if (id) window.open("https://www.strava.com/activities/" + id, "_blank", "noopener,noreferrer");
                                                      }}/>
                                    ) : null}
                                </td>
                                <td className="py-2 px-4 group relative inline-block pt-5 cursor-pointer">
                                    <span
                                        className="">+{Math.round(entry.points_capped, 0).toLocaleString()}P{(entry.points_capped !== entry.points_raw) ?
                                        <span className="text-gray-500">*</span> : null}</span>
                                    <div
                                        className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 p-2 bg-white border dark:bg-gray-800 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto z-10">
                                        <p className="text-sm font-semibold">Breakdown:</p>
                                        <ul className="text-sm list-disc pl-5">
                                            {entry.details.map((detail, detail_index) => (
                                                <li key={"feed" + detail_index + "detail" + detail_index}>{detail.goal__name} +{Math.round(detail.points_capped, 0).toLocaleString()}P {(detail.points_raw !== detail.points_capped) ? (
                                                    <span
                                                        className="text-gray-500 italic"> (uncapped +{Math.round(detail.points_raw, 0).toLocaleString()}P)</span>) : null}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </td>
                            </tr>
                        )
                    }
                ))}
                </tbody>
            </table>
        </BoxSection>
    )
}

function ActivityGoalsBox({user, stats, feed, competitionId, userId, isOwner}) {

    const [showModifyGoals, setShowModifyGoals] = useState(false);

    const goals = stats.competition.goals;
    const [finalGoals, setFinalGoals] = useState(goals);

    useEffect(() => {

        const now = new Date();

        // daily goal - get today 00:00 o'clock
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const epochTimeToday = Math.floor(today.getTime() / 1000); // In seconds

        // week goal - get Monday epoch time
        const day = now.getDay(); // 0 (Sun) to 6 (Sat)
        const diffMonday = (day + 6) % 7; // Days since last Monday
        const lastMonday = new Date(now);
        lastMonday.setDate(now.getDate() - diffMonday);
        lastMonday.setHours(0, 0, 0, 0);
        const epochTimeMonday = Math.floor(lastMonday.getTime() / 1000); // In seconds

        // month goal - get first of month
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        firstOfMonth.setHours(0, 0, 0, 0);
        const epochTimeMonth = Math.floor(firstOfMonth.getTime() / 1000); // In seconds

        const filteredCompetition = lodFilter(feed || [], item => item.workout__user === userId);
        const filteredDay = lodFilter(filteredCompetition, item => item.workout__start_datetime_fmt.epoch >= epochTimeToday);
        const filteredWeek = lodFilter(filteredCompetition, item => item.workout__start_datetime_fmt.epoch >= epochTimeMonday);
        const filteredMonth = lodFilter(filteredCompetition, item => item.workout__start_datetime_fmt.epoch >= epochTimeMonth);

        let tmpGoals = [];
        for (const goal of goals) {

            let filteredList = [];
            if (goal.period === 'day') {
                filteredList = filteredDay;
            } else if (goal.period === 'week') {
                filteredList = filteredWeek;
            } else if (goal.period === 'month') {
                filteredList = filteredMonth;
            } else if (goal.period === 'competition') {
                filteredList = filteredCompetition;
            }

            let scaling = 1;
            if (['kcal', 'kj'].includes(goal.metric)) {
                scaling = user?.scaling_kcal ?? 1;
            } else if (['km'].includes(goal.metric)) {
                scaling = user?.scaling_distance ?? 1;
            }

            tmpGoals.push({
                ...goal,
                goal: goal.goal * scaling,
                min_per_workout: goal.min_per_workout !== null ? goal.min_per_workout * scaling : null,
                max_per_workout: goal.max_per_workout !== null ? goal.max_per_workout * scaling : null,
                min_per_day: goal.min_per_day !== null ? goal.min_per_day * scaling : null,
                max_per_day: goal.max_per_day !== null ? goal.max_per_day * scaling : null,
                min_per_week: goal.min_per_week !== null ? goal.min_per_week * scaling : null,
                max_per_week: goal.max_per_week !== null ? goal.max_per_week * scaling : null,
                points_capped: lodSumby(lodFlatmap(filteredList, 'details').filter(item => item.goal === goal.id), 'points_capped'),
                points_raw: lodSumby(lodFlatmap(filteredList, 'details').filter(item => item.goal === goal.id), 'points_raw'),
            })
        }
        setFinalGoals(tmpGoals);
    }, [stats, feed, userId]);


    return (
        <BoxSection>
            <div className="flex flex-col items-center justify-between sm:flex-row sm:items-center border-b border-gray-200/70 dark:border-ink-700/60 pb-3">
                <span className="mx-4 text-gray-500 uppercase font-bold">Activity Goals</span>
                {isOwner && (
                    <div className="p-0 mt-2.5 sm:mt-0">
                        <ModifyGoalsButton onClick={() => setShowModifyGoals(true)}/>
                    </div>
                )}
            </div>
            <div className="flex flex-col">
                {finalGoals.map((goal, index) => (
                    <div key={goal.id}
                         className="bg-gray-100 dark:bg-gray-900 rounded-lg p-5 m-4 mb-1 group relative">
                        <div className="flex flex-col px-4 text-left">
                            <div className="flex flex-row justify-between items-center text-gray-500 mb-0.5">
                                <div className="tracking-wide"><span className="font-semibold">{goal.name}</span>
                                </div>
                                <div>{Math.round(goal.goal).toLocaleString()} {goal.metric} <span
                                    className="text-xs">/ {goal.period}</span>
                                </div>
                            </div>
                            <div className="flex flex-row pt-2.5 pb-1 justify-between items-center">
                                <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-4"
                                     style={{width: "75%"}}>
                                    <div className="h-4 rounded-full"
                                         style={{
                                             width: Math.min(goal.points_capped, 100) + "%",
                                             backgroundColor: "#b8e62e"
                                         }}></div>
                                </div>
                                <div className="text-volt-600 dark:text-volt-400 text-right"
                                     style={{width: "25%"}}>{Math.round(goal.points_capped).toLocaleString()} P<span
                                    className="text-sm"></span>
                                </div>
                            </div>

                            <div className="text-sm text-gray-400 pt-1.5 hidden group-hover:block">
                                <span className="font-semibold">Limits: </span>
                                {(!(goal.min_per_workout || goal.max_per_workout || goal.min_per_day || goal.max_per_day || goal.min_per_week || goal.max_per_week)) && (
                                    <>None</>
                                )}
                                {(goal.min_per_workout) && (
                                    <><ArrowDownToLine
                                        className="w-4 h-4 inline"/> {Math.round(goal.min_per_workout).toLocaleString()} </>
                                )}
                                {(goal.max_per_workout) && (
                                    <><ArrowUpToLine
                                        className="w-4 h-4 inline"/> {Math.round(goal.max_per_workout).toLocaleString()} </>
                                )}
                                {(goal.min_per_workout || goal.max_per_workout) && (
                                    <span className="text-xs">{goal.metric} / workout </span>
                                )}
                                {(goal.min_per_day) && (
                                    <><ArrowDownToLine
                                        className="w-4 h-4 inline"/> {Math.round(goal.min_per_day).toLocaleString()} </>
                                )}
                                {(goal.max_per_day) && (
                                    <><ArrowUpToLine
                                        className="w-4 h-4 inline"/> {Math.round(goal.max_per_day).toLocaleString()} </>
                                )}
                                {(goal.min_per_day || goal.max_per_day) && (
                                    <span className="text-xs">{goal.metric} / day </span>
                                )}
                                {(goal.min_per_week) && (
                                    <><ArrowDownToLine
                                        className="w-4 h-4 inline"/> {Math.round(goal.min_per_week).toLocaleString()} </>
                                )}
                                {(goal.max_per_week) && (
                                    <><ArrowUpToLine
                                        className="w-4 h-4 inline"/> {Math.round(goal.max_per_week).toLocaleString()} </>
                                )}
                                {(goal.min_per_week || goal.max_per_week) && (
                                    <span className="text-xs">{goal.metric} / week </span>
                                )}

                                {
                                    (['kcal', 'kj', 'km'].includes(goal.metric) && (Math.abs(user.scaling_distance - 1) >= 0.01 || Math.abs(user.scaling_kcal - 1) >= 0.01)) && (
                                        <>
                                            <br/>
                                            <span className="font-semibold">Equalizing Factor: </span>
                                            {
                                                (goal.metric === 'km') ? (
                                                    <span className="text-xs">{Math.round(user.scaling_distance * 100 * 10) / 10}% x {Math.round(goal.goal / user.scaling_distance).toLocaleString()} {goal.metric}</span>
                                                ) : (
                                                    <span className="text-xs">{Math.round(user.scaling_kcal * 100 * 100) / 100}% x {Math.round(goal.goal / user.scaling_kcal).toLocaleString()} {goal.metric}</span>
                                                )
                                            }
                                        </>
                                    )
                                }
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {
                (showModifyGoals) ?
                    <ActivityGoalsForm setModalState={setShowModifyGoals} competitionId={competitionId}/> : null
            }
        </BoxSection>
    );
}


function getWeekDates() {
    const today = new Date();
    const day = today.getDay(); // 0 (Sun) - 6 (Sat)
    const diffToMonday = (day === 0 ? -6 : 1) - day;

    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday);

    return Array.from({length: 7}, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);

        const offset = Math.floor((today - d) / (1000 * 60 * 60 * 24));
        return {
            date: d.toLocaleDateString('en-CA'), // Canadian locale uses YYYY-MM-DD format by default
            offset: offset,
            dateObj: d
        };
    });
}

function Activity7DaysBox({stats, userId, teamId}) {

    const [chartData, setChartData] = useState({'labels': [], 'Me': [], 'My Team': [], 'Average': []});

    useEffect(() => {
        let tmpLegend = [];
        let tmpMe = [];
        let tmpTeam = [];
        let tmpAll = [];
        const participantCount = Math.max(1, stats.competition?.active_member_count);
        const teamMemberCount = Math.max(1, stats.teams[teamId]?.active_member_count);
        for (const entry of getWeekDates()) {
            tmpLegend.push(entry.dateObj.toLocaleDateString('en-US', {weekday: 'short'}));
            tmpMe.push(Math.round(stats?.timeseries?.user?.[userId]?.[entry.offset]?.total * 10) / 10 || 0);
            tmpTeam.push(Math.round(stats?.timeseries?.team?.[teamId]?.[entry.offset]?.total / teamMemberCount * 10) / 10 || 0);
            tmpAll.push(Math.round(stats?.timeseries?.all?.[entry.offset]?.total / participantCount * 10) / 10 || 0);
        }
        setChartData({
            'Legend': tmpLegend,
            'Me': tmpMe,
            'My Team': tmpTeam,
            'Average': tmpAll
        });
    }, [stats, userId, teamId]);

    return (
        <BoxSection>
            <div className="flex flex-col items-center justify-between sm:flex-row sm:items-center border-b border-gray-200/70 dark:border-ink-700/60 pb-3">
                <span className="mx-4 text-gray-500 uppercase font-bold">This Week</span>
            </div>
            <div className="my-3">
                <ChartThisWeek history={chartData}/>
            </div>
        </BoxSection>)
}

function getDateRange(start_date, end_date) {
    const start = new Date(start_date);
    const today = new Date();
    const end = end_date ? new Date(end_date) : today;

    const finalEnd = end > today ? today : end;

    const dates = [];
    let current = new Date(start);

    while (current <= finalEnd) {
        const offset = Math.floor((today - current) / (1000 * 60 * 60 * 24));
        dates.push({
            date: current.toLocaleDateString('en-CA'), // Canadian locale uses YYYY-MM-DD format by default
            offset: offset,
            dateObj: new Date(current)
        });
        current.setDate(current.getDate() + 1);
    }

    return dates;
}


function ActivityCompetitionBox({stats, userId, teamId}) {

    const [chartData, setChartData] = useState({'labels': [], 'Me': [], 'My Team': [], 'Average': []});

    useEffect(() => {
        let tmpLegend = ['Start'];
        let tmpMe = [0];
        let prevMe = 0;
        let tmpTeam = [0];
        let prevTeam = 0;
        let tmpAll = [0];
        let prevAll = 0;
        const participantCount = Math.max(1, stats.competition?.active_member_count);
        const teamMemberCount = Math.max(1, stats.teams[teamId]?.active_member_count);
        for (const entry of getDateRange(stats?.competition?.start_date, stats?.competition?.end_date)) {
            tmpLegend.push(entry.dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })); // Mon, Jan 5
            tmpMe.push((stats?.timeseries?.user?.[userId]?.[entry.offset]?.total + prevMe) || null);
            prevMe += (stats?.timeseries?.user?.[userId]?.[entry.offset]?.total || 0);
            tmpTeam.push((stats?.timeseries?.team?.[teamId]?.[entry.offset]?.total / teamMemberCount + prevTeam) || null);
            prevTeam += (stats?.timeseries?.team?.[teamId]?.[entry.offset]?.total / teamMemberCount || 0);
            tmpAll.push((stats?.timeseries?.all?.[entry.offset]?.total / participantCount + prevAll) || null);
            prevAll += (stats?.timeseries?.all?.[entry.offset]?.total / participantCount || 0);
        }
        setChartData({
            'Legend': tmpLegend,
            'Me': tmpMe,
            'My Team': tmpTeam,
            'Average': tmpAll
        });
    }, [stats, userId, teamId]);

    return (
        <BoxSection>
            <div className="flex flex-col items-center justify-between sm:flex-row sm:items-center border-b border-gray-200/70 dark:border-ink-700/60 pb-3">
                <span className="mx-4 text-gray-500 uppercase font-bold">The Trend</span>
            </div>
            <div className="my-3">
                <ChartHistory history={chartData}/>
            </div>
        </BoxSection>
    )
}


export default function Competition() {
    const navType = useNavigationType();
    useEffect(() => {
        if (navType === "POP") {
            document.body.classList.remove("body-no-scroll");
        }
    }, [navType]);

    const dispatch = useDispatch();
    const {id} = useParams();

    const {
        data: user,
        isLoading: userLoading,
    } = useGetUserByIdQuery('me');

    const {
        data: competition,
        error: competitionError,
        isLoading: competitionLoading,
        refetch: refreshCompetition,
    } = useGetCompetitionByIdQuery(id);

    const {
        data: feed,
        error: feedError,
        isLoading: feedLoading,
        refetch: refreshFeed,
    } = useGetFeedByIdQuery(id, {
        pollingInterval: 90000, // 90 seconds
    });

    const {
        data: stats,
        error: statsError,
        isLoading: statsLoading,
        refetch: refreshStats,
    } = useGetStatsByIdQuery(id, {
        pollingInterval: 90000, // 90 seconds
    });

    const isOwner = (user !== undefined) && (user?.id === competition?.owner);

    const [teamId, setTeamId] = useState(undefined);
    useEffect(() => {
        if (stats?.teams && user?.my_teams) {
            const tmpTeamId = Object.keys(stats?.teams).find(item => user?.my_teams.includes(parseInt(item)));
            setTeamId(tmpTeamId);
        }
    }, [stats, user])

    function refreshPage() {
        refreshCompetition();
        refreshFeed();
        refreshStats();
        dispatch(teamsApi.util.invalidateTags(['Team']));
    }

    // Auto-refresh: when the Drill Instructor posts a new comment (which
    // happens right after a workout is logged and scored), pull the fresh
    // feed/stats so the new activity shows up without a manual refresh.
    // Shares the messages cache with CoachCorner - no extra requests.
    const {data: drillMessages} = useGetDrillMessagesQuery(
        {competition: competition?.id},
        {pollingInterval: 60000, skip: !competition?.id}
    );
    const lastDrillMsgId = React.useRef(null);
    useEffect(() => {
        const latest = drillMessages?.[0];
        if (!latest) return;
        if (lastDrillMsgId.current === null) {
            lastDrillMsgId.current = latest.id; // baseline on first load
            return;
        }
        if (latest.id !== lastDrillMsgId.current) {
            lastDrillMsgId.current = latest.id;
            refreshPage();
        }
    }, [drillMessages]);

    if (competitionError) {
        // Constant format string: the URL param must never end up in the
        // format position of console.log (CodeQL js/tainted-format-string).
        console.log('Error retrieving competition:', id, competitionError);
        return <PageWrapper additionClasses="h-screen flex items-center justify-center"><ErrorBoxSection
            errorMsg={competitionError?.status + ' / ' + (competitionError?.error || competitionError?.message || competitionError?.data?.detail)}/></PageWrapper>;
    }


    return (
        <PageWrapper>

            <div className="container mx-auto p-4">

                {
                    (competitionLoading || feedLoading) ? (
                        <SectionLoader height={"h-48 mb-4"} />
                    ) : (statsError) ? (
                        <ErrorBoxSection additionalClasses='mb-4' errorMsg={statsError?.status + ' / ' + (statsError?.error || statsError?.message || statsError?.data?.detail)}/>
                    ) : (
                        <CompetitionHead competition={competition} feed={feed} isOwner={isOwner} goals={stats?.competition?.goals} user={user} />
                    )
                }

                {/* Leaderboards - the first box after the header */}
                <div className="flex flex-col md:flex-row mb-4">
                    <div className={"w-full mb-4 md:mb-0 " + (competition?.has_teams === false ? "" : "md:w-1/2 md:pr-2")}>
                        {
                            (statsLoading) ? (
                                <SectionLoader/>
                            ) : (statsError) ? (
                                <ErrorBoxSection
                                    errorMsg={statsError?.status + ' / ' + (statsError?.error || statsError?.message || statsError?.data?.detail)}/>
                            ) : (
                                <IndividualLeaderboardBox stats={stats} userId={user?.id}/>
                            )
                        }
                    </div>
                    {(competition?.has_teams === false) ? null : (
                    <div className="w-full md:w-1/2 md:pl-2">
                        {
                            (statsLoading || competitionLoading) ? (
                                <SectionLoader/>
                            ) : (statsError) ? (
                                <ErrorBoxSection
                                    errorMsg={statsError?.status + ' / ' + (statsError?.error || statsError?.message || statsError?.data?.detail)}/>
                            ) : (
                                <TeamLeaderboardBox stats={stats} competition={competition} user={user} teamId={teamId} isOwner={isOwner}/>
                            )
                        }
                    </div>
                    )}
                </div>

                {/* The Drill Instructor's corner */}
                {competition && <CoachCorner competition={competition} isOwner={isOwner}/>}

                {/* KPI bar */}
                <div className="flex flex-col xl:flex-row">
                    <div className="w-full xl:w-1/3">
                        {
                            (statsLoading || feedLoading || userLoading) ? (
                                <SectionLoader/>
                            ) : (statsError) ? (
                                <ErrorBoxSection additionalClasses="mb-4"
                                    errorMsg={statsError?.status + ' / ' + (statsError?.error || statsError?.message || statsError?.data?.detail)}/>
                            ) : (
                                <ActivityGoalsBox user={user} stats={stats} feed={feed} competitionId={id} userId={user?.id} isOwner={isOwner} />
                            )
                        }
                    </div>
                    <div className="w-full xl:w-1/3 my-4 xl:my-0 xl:mx-4">
                        {
                            (statsLoading || userLoading) ? (
                                <SectionLoader/>
                            ) : (statsError) ? (
                                <ErrorBoxSection
                                    errorMsg={statsError?.status + ' / ' + (statsError?.error || statsError?.message || statsError?.data?.detail)}/>
                            ) : (
                                <Activity7DaysBox feed={feed} stats={stats} userId={user?.id} teamId={teamId}/>
                            )
                        }
                    </div>
                    <div className="w-full xl:w-1/3 ">
                        {
                            (statsLoading || userLoading) ? (
                                <SectionLoader/>
                            ) : (statsError) ? (
                                <ErrorBoxSection
                                    errorMsg={statsError?.status + ' / ' + (statsError?.error || statsError?.message || statsError?.data?.detail)}/>
                            ) : (
                                <ActivityCompetitionBox feed={feed} stats={stats} userId={user?.id} teamId={teamId}/>
                            )
                        }
                    </div>
                </div>

                {/* Activity Feed - full width below everything else */}
                <div className="mt-4">
                    {
                        (feedLoading) ? <SectionLoader height={"h-80"}/> : (feedError) ? (
                            <ErrorBoxSection
                                errorMsg={feedError?.status + ' / ' + (feedError?.error || feedError?.message || feedError?.data?.detail)}/>
                        ) : (
                            <FeedBox feed={feed}/>
                        )
                    }
                </div>
            </div>

        </PageWrapper>
    )
}
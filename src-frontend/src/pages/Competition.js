import {useNavigationType, useParams, useSearchParams} from 'react-router-dom';
import React, {useEffect, useState} from "react";
import {useGetCompetitionByIdQuery} from "../utils/reducers/competitionsSlice";
import {
    UsersRound,
} from "lucide-react";
import {SwipePages} from "../components/swipeTabs";
import {statsApi, useGetStatsByIdQuery} from "../utils/reducers/statsSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import {SectionLoader} from "../utils/loaders";
import {useGetFeedByIdQuery} from "../utils/reducers/feedSlice";
import JoinTeamForm from "../forms/joinTeamForm";
import {
    ChangeTeamButton,
} from "../forms/basicComponents";
import {ErrorBoxSection, PageWrapper} from "../utils/miscellaneous";
import {EmptyState, PaneHead, paneCardClass} from "../components/uiBits";
import {useDispatch} from "react-redux";
import {teamsApi} from "../utils/reducers/teamsSlice";
import {drillInstructorApi, useGetDrillConfigsQuery, useGetDrillMessagesQuery} from "../utils/reducers/drillInstructorSlice";
import ProfileAvatar from "../components/ProfileAvatar";
import AthleteCard from "../components/AthleteCard";
import usePollingInterval from "../utils/usePollingInterval";
import {CompetitionHead, CoachCorner} from "../components/competitionChrome";
import EchoChamber from "../components/EchoChamber";


function TeamLeaderboardBox({stats, competition, user, teamId, isOwner}) {
    const dispatch = useDispatch();
    const [openTeam, setOpenTeam] = useState(null);

    const [showChangeTeamModal, setShowChangeTeamModal] = useState(false);
    function setShowChangeTeamModalMiddleware(state) {
        if (state === false) {
            dispatch(statsApi.util.invalidateTags([{ type: 'Stats', id: competition.id }]));
        }
        setShowChangeTeamModal(state);
    }

    return (
        <>
            <div>
                <PaneHead title="Team leaderboard">
                    {(!competition.organizer_assigns_teams || isOwner) && (
                        <ChangeTeamButton onClick={() => setShowChangeTeamModalMiddleware(true)} larger={false}/>
                    )}
                </PaneHead>

                {stats.leaderboard.team.length === 0 ? (
                    <article className={paneCardClass}>
                        <EmptyState title="No teams yet" body="Create the first team and start scoring together."
                                    actionLabel={(!competition.organizer_assigns_teams || isOwner) ? "Add a team" : null}
                                    onAction={(!competition.organizer_assigns_teams || isOwner) ? () => setShowChangeTeamModalMiddleware(true) : null}/>
                    </article>
                ) : (
                    <ul className="space-y-3">
                        {stats.leaderboard.team.map((team) => {
                            const id = team.workout__user__my_teams__id;
                            const mine = parseInt(teamId) === id;
                            const open = openTeam === id;
                            return (
                                <li key={id} className={paneCardClass + (mine ? " ring-1 ring-volt-400/40" : "")}>
                                    <button type="button" onClick={() => setOpenTeam(open ? null : id)}
                                            className="w-full flex items-center gap-3 min-h-[44px] text-left">
                                        <span className="w-8 shrink-0 font-display text-lg text-gray-400">#{team.rank}</span>
                                        <span className="flex-1 min-w-0 font-semibold truncate">{team.name}</span>
                                        <span className="text-xs text-gray-400 inline-flex items-center gap-1 shrink-0">
                                            <UsersRound className="h-3.5 w-3.5"/>{team.members.length}
                                        </span>
                                        <span className="font-semibold shrink-0">{Math.round(team.total_capped || 0).toLocaleString()}P</span>
                                    </button>
                                    {open && (
                                        <ul className="mt-3 space-y-2 border-t border-ink-950/10 dark:border-white/10 pt-3">
                                            {team.members.map((member, i) => {
                                                const factors = effortLabel(member);
                                                return (
                                                <li key={i} className="flex justify-between gap-3 text-sm text-gray-600 dark:text-gray-300">
                                                    <span className="min-w-0">
                                                        <span className="block truncate">{member.username}</span>
                                                        {factors && (
                                                            <span className="block text-[11px] text-gray-400">{factors}</span>
                                                        )}
                                                    </span>
                                                    <span className="shrink-0">{Math.round(member.total_capped || 0).toLocaleString()}P</span>
                                                </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {competition.organizer_assigns_teams ? <p className="pt-2 text-center text-xs text-gray-400">The organizer assigns teams.</p> : null}
            </div>

            {(showChangeTeamModal) && <JoinTeamForm setModalState={setShowChangeTeamModalMiddleware} competition={competition} user={user} isOwner={isOwner}/>}

        </>
    )
}

function effortLabel(person) {
    const effort = Math.round(Number(person?.scaling_kcal ?? 1) * 100);
    const dist = Math.round(Number(person?.scaling_distance ?? 1) * 100);
    if (!Number.isFinite(effort) || !Number.isFinite(dist)) return null;
    return `${effort}% effort · ${dist}% distance`;
}

const RANK_STYLES = {
    1: "text-yellow-500 dark:text-yellow-400",   // gold
    2: "text-gray-400 dark:text-gray-300",       // silver
    3: "text-amber-600 dark:text-amber-500",     // bronze
};

function dayTotal(series, id, offset) {
    return Number(series?.[id]?.[offset]?.total) || Number(series?.[id]?.[String(offset)]?.total) || 0;
}

function WeekBars({values, labels, showLabels = false, tall = false}) {
    const max = Math.max(1, ...values.map((n) => Number(n) || 0));
    const h = tall ? 36 : 18;
    return (
        <div className="min-w-0">
            <div className="flex items-end gap-[3px]" style={{height: h}} aria-hidden="true">
                {values.map((v, i) => {
                    const n = Number(v) || 0;
                    const px = Math.max(n > 0 ? 4 : 2, Math.round((n / max) * h));
                    return (
                        <div key={i} className="flex-1 min-w-[5px] flex items-end justify-center h-full">
                            <div className={"w-full max-w-[10px] rounded-[3px] " +
                                (n > 0 ? "bg-volt-400 shadow-[0_0_8px_rgba(215,255,62,0.45)]" : "bg-ink-950/10 dark:bg-white/10")}
                                 style={{height: px}}/>
                        </div>
                    );
                })}
            </div>
            {showLabels && labels && (
                <div className="flex gap-[3px] mt-1">
                    {labels.map((label, i) => (
                        <span key={i} className="flex-1 text-center text-[8px] font-bold uppercase tracking-wide text-gray-400">
                            {label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function TrendSpark({series, compare}) {
    const w = 160;
    const h = 40;
    const pad = 3;
    const all = [...(series || []), ...(compare || [])].map((n) => Number(n) || 0);
    const max = Math.max(1, ...all);
    const toPts = (arr) => {
        if (!arr || arr.length === 0) return "";
        return arr.map((v, i) => {
            const x = pad + (i / Math.max(1, arr.length - 1)) * (w - pad * 2);
            const y = h - pad - ((Number(v) || 0) / max) * (h - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");
    };
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" aria-hidden="true" preserveAspectRatio="none">
            {compare && compare.length > 1 && (
                <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
                          className="text-gray-300 dark:text-white/25" points={toPts(compare)}/>
            )}
            {series && series.length > 1 && (
                <polyline fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"
                          className="text-volt-500 dark:text-volt-400" points={toPts(series)}/>
            )}
        </svg>
    );
}

function IndividualLeaderboardBox({stats, userId, dunceUserId, feed}) {
    const weekDays = React.useMemo(() => getWeekDates(), [stats]);
    const weekLabels = weekDays.map((d) => d.dateObj.toLocaleDateString("en-US", {weekday: "narrow"}));
    const range = React.useMemo(
        () => getDateRange(stats?.competition?.start_date, stats?.competition?.end_date),
        [stats?.competition?.start_date, stats?.competition?.end_date],
    );
    const fieldN = Math.max(1, stats.competition?.active_member_count || 1);

    function weekValues(id) {
        return weekDays.map((d) => dayTotal(stats?.timeseries?.user, id, d.offset));
    }
    function cumulative(id) {
        let acc = 0;
        return range.map((d) => {
            acc += dayTotal(stats?.timeseries?.user, id, d.offset);
            return acc;
        });
    }
    const [card, setCard] = useState(null);

    const fieldTrend = React.useMemo(() => {
        let acc = 0;
        return range.map((d) => {
            acc += (Number(stats?.timeseries?.all?.[d.offset]?.total)
                || Number(stats?.timeseries?.all?.[String(d.offset)]?.total) || 0) / fieldN;
            return acc;
        });
    }, [range, stats?.timeseries?.all, fieldN]);

    return (
        <div>
            <PaneHead title="Leaderboard" hint="Week bars · trend vs the field"/>

            {(stats.leaderboard.individual.length === 0) ? (
                <article className={paneCardClass}>
                    <EmptyState title="Waiting for the field" body="The first logged workout puts someone on the board."/>
                </article>
            ) : (
                <ul className="space-y-3">
                    {stats.leaderboard.individual.map((person, index) => {
                        const personId = person.id ?? person.workout__user__id;
                        const mine = userId === personId;
                        const week = weekValues(personId);
                        const weekTotal = week.reduce((s, n) => s + n, 0);
                        const factors = effortLabel(person);
                        return (
                        <li key={personId ?? `lb-${index}`}
                            className={paneCardClass + (mine ? " ring-1 ring-volt-400/40" : "")}>
                            <div className="flex items-center gap-3">
                                <span className={"w-8 shrink-0 text-center font-display text-lg " + (RANK_STYLES[person.rank] || "text-gray-400")}>
                                    {person.rank !== null ? `#${person.rank}` : "–"}
                                </span>
                                <div className="relative shrink-0 mr-1.5">
                                    <ProfileAvatar user={person} size={46} dunce={dunceUserId === personId}
                                                   onClick={() => setCard(person)}/>
                                    <span className="absolute -bottom-1 -right-2 rounded-full bg-volt-400 text-ink-950 text-[10px] font-extrabold px-1.5 py-0.5 shadow-glow-volt whitespace-nowrap">
                                        {Math.round(person.total_capped ?? 0).toLocaleString()}P
                                    </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold truncate">{person.username}</p>
                                    {factors && (
                                        <p className="text-[11px] text-gray-400">{factors}</p>
                                    )}
                                    {(person.rank !== null && person.days_on_rank > 0) && (
                                        <p className="text-[11px] text-gray-400">
                                            on #{person.rank} for {person.days_on_rank} {person.days_on_rank === 1 ? "day" : "days"}
                                        </p>
                                    )}
                                </div>
                                {!mine && (
                                    <div className="w-[4.5rem] shrink-0" title={`${Math.round(weekTotal)} pts this week`}>
                                        <WeekBars values={week}/>
                                    </div>
                                )}
                            </div>
                            {mine && (
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-1">
                                            This week · {Math.round(weekTotal)}P
                                        </p>
                                        <WeekBars values={week} labels={weekLabels} showLabels tall/>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-1">
                                            Trend vs field
                                        </p>
                                        <TrendSpark series={cumulative(personId)} compare={fieldTrend}/>
                                    </div>
                                </div>
                            )}
                        </li>
                        );
                    })}
                </ul>
            )}
            {card && (
                <AthleteCard
                    person={card}
                    dunce={dunceUserId === (card.id ?? card.workout__user__id)}
                    weekTotal={weekValues(card.id ?? card.workout__user__id).reduce((s, n) => s + n, 0)}
                    weekBars={<WeekBars values={weekValues(card.id ?? card.workout__user__id)} labels={weekLabels} showLabels tall/>}
                    trendSpark={<TrendSpark series={cumulative(card.id ?? card.workout__user__id)} compare={fieldTrend}/>}
                    feed={feed}
                    onClose={() => setCard(null)}
                />
            )}
        </div>
    )
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


export default function Competition() {
    const navType = useNavigationType();
    useEffect(() => {
        if (navType === "POP") {
            document.body.classList.remove("body-no-scroll");
        }
    }, [navType]);

    const dispatch = useDispatch();
    const {id} = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const pollSlow = usePollingInterval(90000);
    const pollFast = usePollingInterval(60000);
    const tabParam = searchParams.get("tab");
    const tab = (tabParam === "feed" || tabParam === "trophies" || tabParam === "board")
        ? tabParam
        : "feed";
    function setTab(next) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set("tab", next);
        if (next !== "feed") nextParams.delete("reply");
        setSearchParams(nextParams, {replace: true});
    }

    const {
        data: user,
    } = useGetUserByIdQuery('me');

    const {
        data: competition,
        error: competitionError,
        isLoading: competitionLoading,
        refetch: refreshCompetition,
    } = useGetCompetitionByIdQuery(id);

    const {
        data: feed,
        isLoading: feedLoading,
        refetch: refreshFeed,
    } = useGetFeedByIdQuery(id, {
        pollingInterval: pollSlow,
    });

    const {
        data: stats,
        error: statsError,
        isLoading: statsLoading,
        refetch: refreshStats,
    } = useGetStatsByIdQuery(id, {
        pollingInterval: pollSlow,
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
        {pollingInterval: pollFast, skip: !competition?.id}
    );
    const {data: drillConfigs} = useGetDrillConfigsQuery(undefined, {skip: !competition?.id});
    const dunceUserId = (drillConfigs || []).find((c) => c.competition === competition?.id)?.dunce?.user_id ?? null;
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
            dispatch(drillInstructorApi.util.invalidateTags(["DrillEcho"]));
        }
    }, [drillMessages]);

    if (competitionError) {
        // Constant format string: the URL param must never end up in the
        // format position of console.log (CodeQL js/tainted-format-string).
        console.error('Error retrieving competition:', id, competitionError);
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

                <SwipePages tab={tab} onChange={setTab}>
                <div>
                {competition && <CoachCorner competition={competition} isOwner={isOwner}/>}
                </div>

                <div>
                <div className="flex flex-col md:flex-row mb-4">
                    <div className={"w-full mb-4 md:mb-0 " + (competition?.has_teams === false ? "" : "md:w-1/2 md:pr-2")}>
                        {
                            (statsLoading) ? (
                                <SectionLoader/>
                            ) : (statsError) ? (
                                <ErrorBoxSection
                                    errorMsg={statsError?.status + ' / ' + (statsError?.error || statsError?.message || statsError?.data?.detail)}/>
                            ) : (
                                <IndividualLeaderboardBox stats={stats} userId={user?.id} dunceUserId={dunceUserId} feed={feed}/>
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
                </div>

                <div>
                {competition && <EchoChamber competitionId={competition.id} userId={user?.id}/>}
                </div>
                </SwipePages>
            </div>

        </PageWrapper>
    )
}
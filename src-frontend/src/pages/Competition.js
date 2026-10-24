import {useNavigationType, useParams, useSearchParams} from 'react-router-dom';
import React, {useEffect, useMemo, useRef, useState} from "react";
import {useGetCompetitionByIdQuery, useGetExpeditionByCompetitionQuery} from "../utils/reducers/competitionsSlice";
import {
    Trophy,
    UsersRound,
} from "lucide-react";
import {SwipePages, challengeTabs} from "../components/swipeTabs";
import {statsApi, useGetStatsByIdQuery} from "../utils/reducers/statsSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import {SkeletonCard, SkeletonRows} from "../utils/loaders";
import {useGetFeedByIdQuery} from "../utils/reducers/feedSlice";
import JoinTeamForm from "../forms/joinTeamForm";
import CompetitionForm from "../forms/competitionForm";
import {buildRematchSeed} from "../utils/rematch";
import {
    ChangeTeamButton,
} from "../forms/basicComponents";
import {ErrorBoxSection, PageWrapper} from "../utils/miscellaneous";
import {errText} from "../utils/errors";
import {EmptyState, PaneHead, paneCardClass} from "../components/uiBits";
import {useDispatch} from "react-redux";
import {teamsApi} from "../utils/reducers/teamsSlice";
import {drillInstructorApi, messageResults, useGetDrillMessagesQuery} from "../utils/reducers/drillInstructorSlice";
import {clearBodyScrollLock} from "../utils/overlay";
import ProfileAvatar from "../components/ProfileAvatar";
import ExpeditionPanel, {ExpeditionTeaser} from "../components/ExpeditionPanel";
import AthleteCard from "../components/AthleteCard";
import usePollingInterval from "../utils/usePollingInterval";
import {CompetitionHead, CoachCorner} from "../components/competitionChrome";
import EchoLiveStrip from "../components/EchoLiveStrip";
import {ScoreRing, Segmented} from "../components/polishBits";
import {rankPeople, windowTotal} from "../utils/boardPeriod";
import {challengeCountdownLabel} from "../utils/challenge";
import {prefersReducedMotion} from "../utils/motion";
import useWideLayout from "../utils/useWideLayout";


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

    const teams = stats?.leaderboard?.team;
    if (!teams) return <SkeletonRows n={4}/>;

    return (
        <>
            <div>
                <PaneHead title="Team leaderboard">
                    {(!competition.organizer_assigns_teams || isOwner) && (
                        <ChangeTeamButton onClick={() => setShowChangeTeamModalMiddleware(true)} larger={false}/>
                    )}
                </PaneHead>

                {teams.length === 0 ? (
                    <article className={paneCardClass}>
                        <EmptyState title="No teams yet" body="Create the first team and start scoring together."
                                    actionLabel={(!competition.organizer_assigns_teams || isOwner) ? "Add a team" : null}
                                    onAction={(!competition.organizer_assigns_teams || isOwner) ? () => setShowChangeTeamModalMiddleware(true) : null}/>
                    </article>
                ) : (
                    <ul className="space-y-3">
                        {teams.map((team) => {
                            const id = team.workout__user__my_teams__id;
                            const mine = parseInt(teamId) === id;
                            const open = openTeam === id;
                            return (
                                <li key={id} className={paneCardClass + (mine ? " ring-1 ring-white/35" : "")}>
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
                                                            <span className="block text-xs text-gray-400">{factors}</span>
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
    const total = values.reduce((acc, n) => acc + (Number(n) || 0), 0);
    return (
        <div className="min-w-0">
            {/* Text equivalent for screen readers - the bars are aria-hidden. */}
            <span className="sr-only">
                {"Points this week: " + values.map((n, i) => `${labels?.[i] || `Day ${i + 1}`} ${Math.round(Number(n) || 0)}`).join(", ") + ` - total ${Math.round(total)}`}
            </span>
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
                        <span key={i} className="flex-1 text-center text-xs font-bold uppercase tracking-wide text-gray-400">
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
    const first = Number(series?.[0]) || 0;
    const last = Number(series?.[series.length - 1]) || 0;
    const trendText = series && series.length > 1
        ? `Cumulative points trend: from ${Math.round(first)} to ${Math.round(last)}${last >= first ? ", rising" : ", falling"} versus the field average.`
        : "No trend data yet.";
    return (
        <>
        <span className="sr-only">{trendText}</span>
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
        </>
    );
}

const PERIODS = [
    {id: "week", label: "Week"},
    {id: "month", label: "Month"},
    {id: "all", label: "All"},
];

function personIdOf(person) {
    return person?.id ?? person?.workout__user__id;
}

function RankMark({rank}) {
    const prev = useRef(rank);
    const [pop, setPop] = useState(false);
    useEffect(() => {
        if (prev.current !== rank && prev.current != null && rank != null && !prefersReducedMotion()) {
            setPop(true);
            const id = window.setTimeout(() => setPop(false), 250);
            prev.current = rank;
            return () => window.clearTimeout(id);
        }
        prev.current = rank;
        return undefined;
    }, [rank]);
    return (
        <span className={"w-8 shrink-0 text-center font-display text-lg t-stat " +
            (RANK_STYLES[rank] || "text-muted") + (pop ? " rank-pop" : "")}>
            {rank != null ? `#${rank}` : "–"}
        </span>
    );
}

function BoardRow({row, mine, maxScore, onPick, charts = null, bare = false}) {
    const person = row.person;
    const name = mine ? "You" : person.username;
    return (
        <div className={bare ? "px-1 py-1" : paneCardClass + (mine ? " bg-volt-400/10 ring-1 ring-volt-400/35" : "")}>
            <button type="button" onClick={() => onPick(person)}
                    aria-label={`${name}, rank ${row.rank ?? "unranked"}, ${Math.round(row.score)} points`}
                    className="flex w-full min-h-[44px] items-center gap-3 text-left">
                <RankMark rank={row.rank}/>
                <ScoreRing value={row.score} max={maxScore} mine={mine} size={52}>
                    <ProfileAvatar user={person} size={40}/>
                </ScoreRing>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-semibold">
                        {row.rank != null && row.rank <= 3 && (
                            <Trophy className={"h-3.5 w-3.5 shrink-0 " + (RANK_STYLES[row.rank] || "text-muted")} aria-hidden="true"/>
                        )}
                        <span className="truncate">{name}</span>
                    </span>
                    {row.period === "all" && row.rank != null && person.days_on_rank > 0 && (
                        <span className="block text-xs text-muted">
                            on #{row.rank} for {person.days_on_rank} {person.days_on_rank === 1 ? "day" : "days"}
                        </span>
                    )}
                </span>
                <span className="t-stat shrink-0 text-lg font-bold text-volt-600 dark:text-volt-400">
                    {Math.round(row.score).toLocaleString()}
                </span>
            </button>
            {charts}
        </div>
    );
}

function IndividualLeaderboardBox({stats, userId, feed}) {
    // getWeekDates() ignores `stats`; the dep just re-anchors the week
    // labels whenever fresh stats land (a day rollover shows up on poll).
    const weekDays = useMemo(() => getWeekDates(), [stats]);
    const weekLabels = weekDays.map((d) => d.dateObj.toLocaleDateString("en-US", {weekday: "narrow"}));
    const range = useMemo(
        () => getDateRange(stats?.competition?.start_date, stats?.competition?.end_date),
        [stats?.competition?.start_date, stats?.competition?.end_date],
    );
    const fieldN = Math.max(1, stats?.competition?.active_member_count || 1);
    const [card, setCard] = useState(null);
    const [period, setPeriod] = useState("all");
    const meRowRef = useRef(null);
    const [pinMe, setPinMe] = useState(false);

    const fieldTrend = useMemo(() => {
        let acc = 0;
        return range.map((d) => {
            acc += (Number(stats?.timeseries?.all?.[d.offset]?.total)
                || Number(stats?.timeseries?.all?.[String(d.offset)]?.total) || 0) / fieldN;
            return acc;
        });
    }, [range, stats?.timeseries?.all, fieldN]);

    const people = stats?.leaderboard?.individual;
    const rows = useMemo(() => {
        if (!people) return [];
        if (period === "all") {
            return people.map((person) => ({
                person,
                score: Number(person.total_capped) || 0,
                rank: person.rank,
                period: "all",
            }));
        }
        const days = period === "week" ? 7 : 30;
        return rankPeople(people, (person) => windowTotal(
            stats?.timeseries?.user,
            personIdOf(person),
            days,
            dayTotal,
        )).map((row) => ({...row, period}));
    }, [people, period, stats?.timeseries?.user]);

    const meKey = rows.find((row) => personIdOf(row.person) === userId)
        ? String(userId)
        : "";
    useEffect(() => {
        const node = meRowRef.current;
        if (!node || typeof IntersectionObserver === "undefined") {
            setPinMe(false);
            return undefined;
        }
        const obs = new IntersectionObserver(([entry]) => {
            setPinMe(entry ? !entry.isIntersecting : false);
        }, {threshold: 0.4, rootMargin: "0px 0px -72px 0px"});
        obs.observe(node);
        return () => obs.disconnect();
    }, [meKey, period, rows.length]);

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

    if (!people) return <SkeletonRows n={4}/>;

    const maxScore = Math.max(1, ...rows.map((row) => row.score));
    const chips = rows.filter((row) => row.score > 0 && row.rank != null && row.rank <= 3).slice(0, 3);
    const countdown = challengeCountdownLabel(stats?.competition?.end_date);
    const meRow = rows.find((row) => personIdOf(row.person) === userId);

    function myCharts(person) {
        const personId = personIdOf(person);
        const week = weekValues(personId);
        const weekTotal = week.reduce((s, n) => s + n, 0);
        return (
            <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                    <p className="t-caption text-muted mb-1">
                        This week · {Math.round(weekTotal)}P
                    </p>
                    <WeekBars values={week} labels={weekLabels} showLabels tall/>
                </div>
                <div className="min-w-0">
                    <p className="t-caption text-muted mb-1">
                        Trend vs field
                    </p>
                    <TrendSpark series={cumulative(personId)} compare={fieldTrend}/>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <h2 className="t-pane text-muted">Leaderboard</h2>
                {countdown && (
                    <span className="rounded-full bg-ink-950/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-muted dark:bg-ink-850">
                        {countdown}
                    </span>
                )}
            </div>
            <div className="mb-3">
                <Segmented value={period} onChange={setPeriod} options={PERIODS} label="Leaderboard period"/>
            </div>

            {(people.length === 0) ? (
                <article className={paneCardClass}>
                    <EmptyState title="Waiting for the field" body="The first logged workout puts someone on the board."/>
                </article>
            ) : (
                <>
                    {chips.length > 0 && (
                        <ol className="mb-3 grid grid-cols-3 gap-2" aria-label="Top three">
                            {chips.map((row) => (
                                <li key={personIdOf(row.person)}>
                                    <button type="button" onClick={() => setCard(row.person)}
                                            className="flex min-h-[44px] w-full flex-col items-start rounded-2xl bg-ink-950/5 px-2.5 py-2 text-left dark:bg-ink-850">
                                        <span className={"inline-flex items-center gap-1 text-xs font-bold " + (RANK_STYLES[row.rank] || "text-muted")}>
                                            <Trophy className="h-3.5 w-3.5" aria-hidden="true"/>
                                            #{row.rank}
                                        </span>
                                        <span className="mt-0.5 w-full truncate text-sm font-semibold">
                                            {personIdOf(row.person) === userId ? "You" : row.person.username}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ol>
                    )}
                <ul className="space-y-3">
                    {rows.map((row, index) => {
                        const personId = personIdOf(row.person);
                        const mine = userId === personId;
                        return (
                        <li key={personId ?? `lb-${index}`} ref={mine ? meRowRef : undefined}>
                            <BoardRow
                                row={row}
                                mine={mine}
                                maxScore={maxScore}
                                onPick={setCard}
                                charts={mine && period === "all" ? myCharts(row.person) : null}
                            />
                        </li>
                        );
                    })}
                </ul>
                </>
            )}
            {pinMe && meRow && (
                <div className="pointer-events-none fixed inset-x-0 z-30 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] px-3 md:bottom-4 md:left-[7.5rem] md:right-4 md:px-0">
                    <div className="glass-dock pointer-events-auto rounded-2xl px-2 py-1">
                        <BoardRow bare row={meRow} mine maxScore={maxScore} onPick={(person) => {
                            meRowRef.current?.scrollIntoView({
                                behavior: prefersReducedMotion() ? "auto" : "smooth",
                                block: "center",
                            });
                            setCard(person);
                        }}/>
                    </div>
                </div>
            )}
            {card && (
                <AthleteCard
                    person={{...card, rank: rows.find((row) => personIdOf(row.person) === personIdOf(card))?.rank ?? card.rank,
                        total_capped: rows.find((row) => personIdOf(row.person) === personIdOf(card))?.score ?? card.total_capped}}
                    weekTotal={weekValues(personIdOf(card)).reduce((s, n) => s + n, 0)}
                    weekBars={<WeekBars values={weekValues(personIdOf(card))} labels={weekLabels} showLabels tall/>}
                    trendSpark={<TrendSpark series={cumulative(personIdOf(card))} compare={fieldTrend}/>}
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
            clearBodyScrollLock();
        }
    }, [navType]);

    const dispatch = useDispatch();
    const [showRematchForm, setShowRematchForm] = useState(false);
    const [echoArchiveHost, setEchoArchiveHost] = useState(null);
    const {id} = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const pollSlow = usePollingInterval(90000);
    const tabParam = searchParams.get("tab");
    // The Trail page exists only while the challenge runs an Expedition;
    // a stale ?tab=trail link falls back to the feed.
    const {data: expedition} = useGetExpeditionByCompetitionQuery(id, {skip: !id});
    const hasTrail = !!expedition?.enabled;
    const tabs = useMemo(() => challengeTabs(hasTrail), [hasTrail]);
    const tab = (tabParam === "feed" || tabParam === "board" || (tabParam === "trail" && hasTrail))
        ? tabParam
        : "feed";
    // Stats stay skipped on Feed for first paint. A swipe mounts Board
    // before ?tab= changes, so peek starts the query during the gesture.
    const [statsPeeked, setStatsPeeked] = useState(false);
    function setTab(next) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set("tab", next);
        if (next !== "feed") nextParams.delete("reply");
        setSearchParams(nextParams, {replace: true});
    }
    function peekTab(next) {
        if (next === "board") setStatsPeeked(true);
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
        refetch: refreshFeed,
    } = useGetFeedByIdQuery(id, {
        pollingInterval: pollSlow,
    });

    // Wide screens (foldable landscape / desktop) show feed and board
    // side by side - no tabs, so stats must load and poll immediately.
    const wide = useWideLayout();
    const {
        data: stats,
        error: statsError,
        isLoading: statsLoading,
        refetch: refreshStats,
    } = useGetStatsByIdQuery(id, {
        skip: !wide && tab === "feed" && !statsPeeked,
        pollingInterval: (wide || tab === "board") ? pollSlow : 0,
    });

    const isOwner = (user !== undefined) && (user?.id === competition?.owner);
    const rematchSeed = useMemo(() => buildRematchSeed(competition), [competition]);

    const teamId = useMemo(() => {
        if (stats?.teams && user?.my_teams) {
            return Object.keys(stats.teams).find(item => user.my_teams.includes(parseInt(item)));
        }
        return undefined;
    }, [stats, user]);

    // Auto-refresh: when the Drill Instructor posts a new comment (which
    // happens right after a workout is logged and scored), pull the fresh
    // feed/stats so the new activity shows up without a manual refresh.
    // Shares the messages cache with CoachCorner - no extra requests.
    const {data: drillMessages} = useGetDrillMessagesQuery(
        {competition: competition?.id, limit: 15, offset: 0},
        {skip: !competition?.id},
    );
    const lastDrillMsgId = React.useRef(null);
    useEffect(() => {
        const latest = messageResults(drillMessages)[0];
        if (!latest) return;
        if (lastDrillMsgId.current === null) {
            lastDrillMsgId.current = latest.id; // baseline on first load
            return;
        }
        if (latest.id !== lastDrillMsgId.current) {
            lastDrillMsgId.current = latest.id;
            refreshFeed();
            dispatch(drillInstructorApi.util.invalidateTags(["DrillEcho"]));
        }
    }, [drillMessages]);

    if (competitionError) {
        // Constant format string: the URL param must never end up in the
        // format position of console.log (CodeQL js/tainted-format-string).
        console.error('Error retrieving competition:', id, competitionError);
        return <PageWrapper additionClasses="h-screen flex items-center justify-center"><ErrorBoxSection
            errorMsg={errText(competitionError, 'Could not load this challenge. Please try again.')}/></PageWrapper>;
    }


    return (
        <PageWrapper>
            {(competitionLoading) ? (
                <div className="container mx-auto space-y-3 p-4" role="status" aria-label="Loading"><SkeletonCard height="h-48"/><SkeletonRows n={3}/></div>
            ) : (
                <CompetitionHead
                    competition={competition}
                    feed={feed}
                    isOwner={isOwner}
                    goals={competition?.goals || stats?.competition?.goals}
                    user={user}
                    archiveSlotRef={setEchoArchiveHost}
                />
            )}
            {!competitionLoading && statsError && (
                <div className="container mx-auto px-4">
                    <ErrorBoxSection additionalClasses="mb-4" errorMsg={errText(statsError, 'Could not load the leaderboard. Please try again.')}/>
                </div>
            )}

            <div className="container mx-auto p-4">

                {(() => {
                    const trailPanel = competition && (
                        <ExpeditionPanel
                            competitionId={competition.id}
                            canRematch={isOwner}
                            onRematch={() => setShowRematchForm(true)}
                        />
                    );
                    const feedPane = (
                        <div>
                        {!wide && hasTrail && (
                            <ExpeditionTeaser expedition={expedition} onOpen={() => setTab("trail")}/>
                        )}
                        {competition && <EchoLiveStrip competitionId={competition.id} userId={user?.id} archiveHost={echoArchiveHost} placeArchiveInHeader/>}
                        {competition && <CoachCorner competition={competition} isOwner={isOwner}/>}
                        </div>
                    );
                    const trailPane = <div>{trailPanel}</div>;
                    const boardPane = (
                        <div>
                        {wide && trailPanel}
                        {/* A stats failure is shown ONCE in the header position above
                            - not repeated inside each leaderboard column. */}
                        {statsError ? null : (
                        // One board column at lg+: the two leaderboards
                        // already get a full half of the wide screen each
                        // time (feed takes the other). Stacked they stay
                        // readable even with many teams.
                        <div className={"flex flex-col mb-4 " + (wide ? "" : "md:flex-row")}>
                            <div className={"w-full mb-4 md:mb-0 " + (wide ? "" : (competition?.has_teams === false ? "" : "md:w-1/2 md:pr-2"))}>
                                {
                                    (statsLoading || !stats) ? (
                                        <SkeletonRows n={4}/>
                                    ) : (
                                        <IndividualLeaderboardBox stats={stats} userId={user?.id} feed={feed}/>
                                    )
                                }
                            </div>
                            {(competition?.has_teams === false) ? null : (
                            <div className={"w-full " + (wide ? "" : "md:w-1/2 md:pl-2")}>
                                {
                                    (statsLoading || competitionLoading || !stats) ? (
                                        <SkeletonRows n={4}/>
                                    ) : (
                                        <TeamLeaderboardBox stats={stats} competition={competition} user={user} teamId={teamId} isOwner={isOwner}/>
                                    )
                                }
                            </div>
                            )}
                        </div>
                        )}
                        </div>
                    );
                    // lg+: feed and leaderboard side by side, no swipe
                    // carousel and no tab bar (everything is visible).
                    if (wide) {
                        return (
                            <div className="grid grid-cols-2 gap-4 items-start stagger-in">
                                {feedPane}
                                {boardPane}
                            </div>
                        );
                    }
                    return (
                        <SwipePages tab={tab} onChange={setTab} onPeek={peekTab} tabs={tabs}>
                            {feedPane}
                            {hasTrail && trailPane}
                            {boardPane}
                        </SwipePages>
                    );
                })()}
            </div>
            {showRematchForm && competition && isOwner && (
                <CompetitionForm
                    initialValues={rematchSeed}
                    isRematch
                    setModalState={setShowRematchForm}
                />
            )}

        </PageWrapper>
    )
}
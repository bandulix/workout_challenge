import {useNavigationType, useParams} from 'react-router-dom';
import React, {useEffect, useState} from "react";
import {useGetCompetitionByIdQuery} from "../utils/reducers/competitionsSlice";
import {
    UsersRound,
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
import lodSumby from 'lodash/sumBy';
import {SectionLoader} from "../utils/loaders";
import {useGetFeedByIdQuery} from "../utils/reducers/feedSlice";
import JoinTeamForm from "../forms/joinTeamForm";
import ActivityGoalsForm from "../forms/activityGoalsForm";
import {
    ChangeTeamButton,
    Modal,
    ModifyGoalsButton,
    StravaButton,
} from "../forms/basicComponents";
import {BoxSection, ErrorBoxSection, PageWrapper, useDarkMode} from "../utils/miscellaneous";
import {sportLabelShort} from "../forms/workoutForm";
import {Chip, EmptyState, SectionHead, VOLT} from "../components/uiBits";
import {useDispatch} from "react-redux";
import {teamsApi} from "../utils/reducers/teamsSlice";
import {useGetDrillConfigsQuery, useGetDrillMessagesQuery, useGetHallOfRoastsQuery} from "../utils/reducers/drillInstructorSlice";
import ProfileAvatar from "../components/ProfileAvatar";
import usePollingInterval from "../utils/usePollingInterval";
import {CompetitionHead, CoachCorner} from "../components/competitionChrome";
import {HallOfRoasts, OrderRibbon} from "../components/gameBits";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip, Legend, BarElement, ChartDataLabels);


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
                backgroundColor: VOLT,
                borderRadius: 6,
                clip: false,
            },
            {
                label: 'My Team',
                data: history['My Team'],
                backgroundColor: '#3a4a26',
                borderRadius: 6,
                clip: false,
                hidden: true,
            },
            {
                label: 'Average',
                data: history['Average'],
                backgroundColor: isDarkMode ? '#27331a' : '#d1d5db',
                borderRadius: 6,
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
                position: 'bottom',
                labels: {
                    boxWidth: 12,
                    padding: 20,
                    color: isDarkMode ? '#c5d0b0' : '#4b5563',
                },
            },
            tooltip: false,
            datalabels: {
                anchor: 'end',
                align: 'end',
                color: isDarkMode ? '#d7ff3e' : '#6f8f0f',
                font: {weight: 'bold'},
            },
        },
    }), [isDarkMode]);

    const weekTotal = React.useMemo(
        () => (history.Me || []).reduce((sum, n) => sum + (Number(n) || 0), 0),
        [history],
    );

    return (
        <div>
            <div className="px-2 pb-3 flex items-baseline gap-2">
                <span className="font-display text-3xl text-volt-500 dark:text-volt-400 leading-none">{Math.round(weekTotal)}</span>
                <span className="text-xs uppercase tracking-wide text-gray-400">pts this week</span>
            </div>
            <Bar data={data} options={options} plugins={[ChartDataLabels]}/>
        </div>
    )
}


function ChartHistory({history}) {
    const isDarkMode = useDarkMode();
    const data = React.useMemo(() => ({
        labels: history['Legend'],
        datasets: [
            {
                label: 'Me',
                data: history['Me'],
                borderColor: VOLT,
                tension: 0.3,
                fill: false,
                spanGaps: true,
            },
            {
                label: 'My Team',
                data: history['My Team'],
                borderColor: '#3a4a26',
                tension: 0.3,
                fill: false,
                spanGaps: true,
            },
            {
                label: 'Average',
                data: history['Average'],
                borderColor: isDarkMode ? '#6b7a52' : '#9ca3af',
                tension: 0.3,
                fill: false,
                spanGaps: true,
            },
        ],
    }), [history, isDarkMode]);

    const options = React.useMemo(() => ({
        scales: {
            x: {display: false},
            y: {
                display: true,
                position: 'right',
                grid: {display: false},
                ticks: {
                    padding: 10,
                    color: isDarkMode ? '#d7ff3e' : '#6f8f0f',
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
                position: 'bottom',
                labels: {
                    boxWidth: 12,
                    padding: 20,
                    color: isDarkMode ? '#c5d0b0' : '#4b5563',
                },
            },
            datalabels: {display: false},
        },
    }), [isDarkMode]);
    return (
        <Line data={data} options={options}/>
    )
}



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
            <BoxSection>
                <SectionHead title="Team leaderboard">
                    {(!competition.organizer_assigns_teams || isOwner) && (
                        <ChangeTeamButton onClick={() => setShowChangeTeamModalMiddleware(true)} larger={false}/>
                    )}
                </SectionHead>

                {stats.leaderboard.team.length === 0 ? (
                    <EmptyState title="No teams yet" body="Create the first team and start scoring together."
                                actionLabel={(!competition.organizer_assigns_teams || isOwner) ? "Add a team" : null}
                                onAction={(!competition.organizer_assigns_teams || isOwner) ? () => setShowChangeTeamModalMiddleware(true) : null}/>
                ) : (
                    <ul className="mt-1 divide-y divide-gray-100 dark:divide-ink-700/60">
                        {stats.leaderboard.team.map((team) => {
                            const id = team.workout__user__my_teams__id;
                            const mine = parseInt(teamId) === id;
                            const open = openTeam === id;
                            return (
                                <li key={id} className={mine ? "bg-volt-400/10 dark:bg-volt-400/5 rounded-2xl" : ""}>
                                    <button type="button" onClick={() => setOpenTeam(open ? null : id)}
                                            className="w-full flex items-center gap-3 py-3 px-2 min-h-[44px] text-left">
                                        <span className="w-8 shrink-0 font-display text-lg text-gray-400">#{team.rank}</span>
                                        <span className="flex-1 min-w-0 font-semibold truncate">{team.name}</span>
                                        <span className="text-xs text-gray-400 inline-flex items-center gap-1 shrink-0">
                                            <UsersRound className="h-3.5 w-3.5"/>{team.members.length}
                                        </span>
                                        <span className="font-semibold shrink-0">{Math.round(team.total_capped || 0).toLocaleString()}P</span>
                                    </button>
                                    {open && (
                                        <ul className="px-4 pb-3 space-y-1">
                                            {team.members.map((member, i) => (
                                                <li key={i} className="flex justify-between text-sm text-gray-600 dark:text-gray-300">
                                                    <span>{member.username}</span>
                                                    <span>{Math.round(member.total_capped || 0).toLocaleString()}P</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {competition.organizer_assigns_teams ? <p className="pt-2 text-center text-xs text-gray-400">The organizer assigns teams.</p> : null}
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

function IndividualLeaderboardBox({stats, userId, dunceUserId}) {

    return (
        <BoxSection>
            <SectionHead title="Leaderboard"/>

            {(stats.leaderboard.individual.length === 0) ? (
                <EmptyState title="Waiting for the field" body="The first logged workout puts someone on the board."/>
            ) : (
                <ul className="my-1">
                    {stats.leaderboard.individual.map((person, index) => (
                        <li key={person.workout__user__id}
                            className={"flex items-center gap-3 px-3 py-2.5 rounded-2xl " + ((userId === person.workout__user__id) ? "bg-volt-400/10 dark:bg-volt-400/5 " : "")}>
                            {/* Rank - medal colours for the podium */}
                            <span className={"w-8 shrink-0 text-center font-display text-lg " + (RANK_STYLES[person.rank] || "text-gray-400")}>
                                {person.rank !== null ? `#${person.rank}` : "–"}
                            </span>

                            {/* Profile picture with the points badge hovering
                                partly over its bottom-right corner */}
                            <div className="relative shrink-0 mr-1.5">
                                <ProfileAvatar user={person} size={46} dunce={dunceUserId === person.workout__user__id}/>
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


const FEED_PREVIEW = 5;

function durationLabel(entry) {
    if (entry.workout__sport_type === "Steps") return `${entry.workout__steps?.toLocaleString() || 0} steps`;
    const mins = Math.round(parseFloat(entry.workout__duration) / 60) || 0;
    return `${mins} min`;
}

function feedDayLabel(entry) {
    const ago = entry.workout__start_datetime_fmt?.days_ago;
    if (ago === 0) return "Today";
    if (ago === 1) return "Yesterday";
    return entry.workout__start_datetime_fmt?.date_readable || "";
}

function groupFeedByDay(items) {
    const groups = [];
    for (const entry of items) {
        const key = entry.workout__start_datetime_fmt?.date_iso || "unknown";
        const last = groups[groups.length - 1];
        if (!last || last.key !== key) {
            groups.push({key, label: feedDayLabel(entry), items: [entry]});
        } else {
            last.items.push(entry);
        }
    }
    return groups;
}

function FeedEntry({entry, open, onToggle, showDate = true}) {
    return (
        <li>
            <button type="button" onClick={onToggle}
                    className="w-full flex items-center gap-3 py-3 px-1 min-h-[44px] text-left rounded-2xl hover:bg-gray-50 dark:hover:bg-ink-800 transition">
                <ProfileAvatar user={{first_name: entry.workout__user__username, profile_picture: entry.workout__user__profile_picture}} size={36}/>
                <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{entry.workout__user__username}</p>
                    <p className="text-xs text-gray-400">
                        {durationLabel(entry)} {sportLabelShort(entry.workout__sport_type)}
                        {showDate ? ` · ${entry.workout__start_datetime_fmt?.date_readable}` : ` · ${entry.workout__start_datetime_fmt?.time_24h}`}
                    </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <OrderRibbon show={!!entry.order_ribbon}/>
                    <Chip>+{Math.round(entry.points_capped || 0).toLocaleString()}P{entry.points_capped !== entry.points_raw ? "*" : ""}</Chip>
                </div>
            </button>
            {open && (
                <div className="px-3 pb-3 flex flex-wrap items-start gap-3">
                    <ul className="flex-1 text-sm text-gray-600 dark:text-gray-300 space-y-0.5">
                        {(entry.details || []).map((detail, i) => (
                            <li key={i}>
                                {detail.goal__name} +{Math.round(detail.points_capped || 0).toLocaleString()}P
                                {detail.points_raw !== detail.points_capped && (
                                    <span className="text-gray-400 italic"> (raw {Math.round(detail.points_raw || 0)}P)</span>
                                )}
                            </li>
                        ))}
                    </ul>
                    {(entry.workout__user__strava_allow_follow && entry.workout__strava_id) ? (
                        <StravaButton label={"Like Activity"}
                                      onClick={() => {
                                          const id = String(entry.workout__strava_id).replace(/[^0-9]/g, '');
                                          if (id) window.open("https://www.strava.com/activities/" + id, "_blank", "noopener,noreferrer");
                                      }}/>
                    ) : null}
                </div>
            )}
        </li>
    );
}

function FeedHistory({items, openId, setOpenId}) {
    return (
        <div className="max-h-[70vh] overflow-y-auto -mx-1 px-1">
            {groupFeedByDay(items).map((group) => (
                <section key={group.key} className="mb-2">
                    <h3 className="sticky top-0 z-10 bg-white/95 dark:bg-ink-850/95 backdrop-blur px-1 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                        {group.label}
                    </h3>
                    <ul className="divide-y divide-gray-100 dark:divide-ink-700/60">
                        {group.items.map((entry) => (
                            <FeedEntry key={entry.workout} entry={entry} showDate={false}
                                       open={openId === entry.workout}
                                       onToggle={() => setOpenId(openId === entry.workout ? null : entry.workout)}/>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function FeedBox({feed}) {
    const [openId, setOpenId] = useState(null);
    const [showHistory, setShowHistory] = useState(false);
    const items = feed || [];
    const preview = items.slice(0, FEED_PREVIEW);
    const older = Math.max(0, items.length - FEED_PREVIEW);

    return (
        <BoxSection>
            <SectionHead title="Activity feed" hint={items.length > FEED_PREVIEW ? `Latest ${FEED_PREVIEW} of ${items.length}` : null}/>

            {items.length === 0 ? (
                <EmptyState title="The feed is quiet" body="The next logged workout lands here for everyone to see."/>
            ) : (
                <>
                    <ul className="mt-1 divide-y divide-gray-100 dark:divide-ink-700/60">
                        {preview.map((entry) => (
                            <FeedEntry key={entry.workout} entry={entry}
                                       open={openId === entry.workout}
                                       onToggle={() => setOpenId(openId === entry.workout ? null : entry.workout)}/>
                        ))}
                    </ul>
                    {older > 0 && (
                        <button type="button" onClick={() => setShowHistory(true)}
                                className="mt-3 w-full min-h-[44px] rounded-2xl border border-volt-400/40 text-sm font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300 hover:bg-volt-400/10 transition">
                            {older} older {older === 1 ? "activity" : "activities"}
                        </button>
                    )}
                </>
            )}

            {showHistory && (
                <Modal title="Activity history" setShowModal={setShowHistory}>
                    <FeedHistory items={items} openId={openId} setOpenId={setOpenId}/>
                </Modal>
            )}
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
            <SectionHead title="Activity goals">
                {isOwner && <ModifyGoalsButton onClick={() => setShowModifyGoals(true)}/>}
            </SectionHead>
            {finalGoals.length === 0 ? (
                <EmptyState title="No goals yet"
                            body={isOwner ? "Set the first target so the field knows what to chase." : "The organizer hasn't set activity goals yet."}
                            actionLabel={isOwner ? "Add goals" : null}
                            onAction={isOwner ? () => setShowModifyGoals(true) : null}/>
            ) : (
            <div className="flex flex-col gap-3 mt-3">
                {finalGoals.map((goal) => {
                    const pct = Math.min(Math.max(Number(goal.points_capped) || 0, 0), 100);
                    const complete = (Number(goal.points_capped) || 0) >= 100;
                    const empty = (Number(goal.points_capped) || 0) <= 0;
                    const limits = [];
                    if (goal.min_per_workout) limits.push(`min ${Math.round(goal.min_per_workout)} / workout`);
                    if (goal.max_per_workout) limits.push(`max ${Math.round(goal.max_per_workout)} / workout`);
                    if (goal.min_per_day) limits.push(`min ${Math.round(goal.min_per_day)} / day`);
                    if (goal.max_per_day) limits.push(`max ${Math.round(goal.max_per_day)} / day`);
                    if (goal.min_per_week) limits.push(`min ${Math.round(goal.min_per_week)} / week`);
                    if (goal.max_per_week) limits.push(`max ${Math.round(goal.max_per_week)} / week`);
                    return (
                        <div key={goal.id} className="rounded-2xl bg-gray-50 dark:bg-ink-900 border border-gray-200/60 dark:border-ink-700/60 p-4">
                            <div className="flex justify-between items-baseline gap-2">
                                <p className="font-semibold truncate">{goal.name}</p>
                                <p className="text-xs text-gray-400 shrink-0">{Math.round(goal.goal).toLocaleString()} {goal.metric} / {goal.period}</p>
                            </div>
                            <div className="mt-2 flex items-center gap-3">
                                <div className="flex-1 h-3 rounded-full bg-gray-200 dark:bg-ink-700 overflow-hidden">
                                    <div className={"h-full rounded-full transition-all " + (empty ? "bg-ink-600" : complete ? "bg-volt-400" : "bg-gradient-to-r from-volt-600 to-volt-400")}
                                         style={{width: pct + "%"}}/>
                                </div>
                                <span className="text-sm font-bold text-volt-700 dark:text-volt-400 w-12 text-right">{Math.round(goal.points_capped || 0)}P</span>
                            </div>
                            <p className="mt-1.5 text-[11px] text-gray-400">
                                {limits.length ? limits.join(" · ") : "No caps"}
                                {['kcal', 'kj', 'km'].includes(goal.metric) && user && (Math.abs((user.scaling_distance || 1) - 1) >= 0.01 || Math.abs((user.scaling_kcal || 1) - 1) >= 0.01) && (
                                    <> · equalizer {goal.metric === "km" ? Math.round(user.scaling_distance * 1000) / 10 : Math.round(user.scaling_kcal * 10000) / 100}%</>
                                )}
                            </p>
                        </div>
                    );
                })}
            </div>
            )}
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
            <SectionHead title="This week"/>
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
            <SectionHead title="The trend"/>
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
    const pollSlow = usePollingInterval(90000);
    const pollFast = usePollingInterval(60000);

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
    const {data: hall} = useGetHallOfRoastsQuery(id, {pollingInterval: pollSlow, skip: !id});
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
                                <IndividualLeaderboardBox stats={stats} userId={user?.id} dunceUserId={dunceUserId}/>
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

                {(hall || []).length > 0 && (
                    <div className="mt-4">
                        <HallOfRoasts cards={hall}/>
                    </div>
                )}

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
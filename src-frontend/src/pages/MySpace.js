import React, {useEffect, useMemo, useState} from "react";
import {
    Check,
    CheckCheck,
    Dumbbell,
    Flame,
    Timer,
    Ruler,
    Download,
    X,
} from 'lucide-react';
import {useGetWorkoutsQuery, workoutsApi} from "../utils/reducers/workoutsSlice";
import WorkoutForm, {sportLabelShort} from "../forms/workoutForm";
import lodFilter from 'lodash/filter';
import lodFind from 'lodash/find';
import lodFrompairs from 'lodash/fromPairs';
import lodGroupby from 'lodash/groupBy';
import lodMapvalues from 'lodash/mapValues';
import lodOrderby from 'lodash/orderBy';
import lodSumby from 'lodash/sumBy';
import lodTopairs from 'lodash/toPairs';
import lodUniqby from 'lodash/uniqBy';
import lodValues from 'lodash/values';
import {useGetUserByIdQuery, usersApi} from "../utils/reducers/usersSlice";
import {useGetCompetitionsQuery} from "../utils/reducers/competitionsSlice";
import CompetitionForm from "../forms/competitionForm";
import PersonalGoalsForm from "../forms/personalGoalsForm";
import {useLocation, useNavigate, useNavigationType, useSearchParams} from "react-router-dom";
import JoinCompetitionForm from "../forms/joinCompetitionForm";
import SettingsForm from "../forms/settingsForm";
import {LinkStravaScreen} from "./HowTo";
import {
    AddButton,
    JoinButton,
    ModifyGoalsButton,
} from "../forms/basicComponents";
import {BoxSection, ErrorBoxSection, PageWrapper} from "../utils/miscellaneous";
import {SectionLoader} from "../utils/loaders";
import {useDispatch} from "react-redux";
import {apkDownloadHref, useApkUpdateInfo} from "../utils/apkUpdate";
import {useLazySyncGarminQuery, useLazySyncStravaQuery, useLazySyncHealthQuery} from "../utils/reducers/linkSlice";
import {nativeHealthKickSync} from "../utils/nativeHealth";
import {statsApi, useGetStatsByIdQuery} from "../utils/reducers/statsSlice";
import {feedApi} from "../utils/reducers/feedSlice";
import {BeatLoader} from "react-spinners";
import ProfileAvatar from "../components/ProfileAvatar";
import {Chip, EmptyState, SectionHead, SyncChip, rowClass, VOLT} from "../components/uiBits";
import usePollingInterval from "../utils/usePollingInterval";
import {notice} from "../utils/dialogs";


function WelcomeBox({user, workouts}) {

    const [countTotal, setCountTotal] = useState(0);
    const [countGroups, setCountGroups] = useState({});

    useEffect(() => {
        if (workouts !== undefined) {
            const filteredWorkouts = lodFilter(workouts || [], item => item.sport_type !== 'Steps');
            setCountTotal(filteredWorkouts.length);
            const grouped = lodMapvalues(lodGroupby(lodValues(filteredWorkouts), 'sport_type'), group => group.length);
            const sorted = lodFrompairs(lodOrderby(lodTopairs(grouped), ([, value]) => value, 'desc'));
            const limited = Object.fromEntries(Object.entries(sorted).slice(0, 4));
            setCountGroups(limited);
        }
    }, [workouts]);

    return (
        <BoxSection additionalClasses={"mb-4"}>
            {/* Compact header: small avatar with the name beside it,
                lifetime total and top sport counts on the right. On narrow
                (smartphone) widths the count block wraps to a second row
                (flex-wrap + basis on the name) so a longer first name is
                no longer crushed between the avatar and the counter. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 sm:px-3">
                <ProfileAvatar user={user} size={64} editable className="shrink-0"/>
                <div className="flex-1 min-w-0 basis-40">
                    <p className="text-xs text-gray-500">Welcome back,</p>
                    <p className="text-xl font-display uppercase tracking-wide truncate">{user.first_name}</p>
                </div>
                <div className="flex items-baseline gap-1.5 shrink-0 ml-auto sm:ml-0">
                    <span className="text-2xl font-display text-volt-500 dark:text-volt-400">{countTotal}</span>
                    <span className="uppercase text-[10px] tracking-wide text-gray-500">workouts</span>
                </div>
                {Object.entries(countGroups).map(([label, count], index) => (
                    <div key={"stat" + index} className="hidden lg:flex lg:flex-col lg:items-center shrink-0 px-1">
                        <span className="text-lg font-semibold leading-tight">{count}</span>
                        <span className="uppercase text-[10px] tracking-wide text-gray-500">{sportLabelShort(label)}</span>
                    </div>
                ))}
            </div>
        </BoxSection>
    )
}


function WorkoutsBox({workouts, user, setLinkStrava}) {

    const [showEditWorkoutModal, setShowEditWorkoutModal] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const stravaLinked = user?.strava_athlete_id !== null && user?.strava_athlete_id !== undefined;
    const garminLinked = Boolean(user?.garmin_email);
    const healthLinked = Boolean(user?.health_user_id);
    // With several providers linked only the selected source imports (the
    // others would double every activity) - hide their re-sync buttons.
    // `activity_source_effective` is undefined on pre-selector backends,
    // which keeps the old show-all-linked behaviour until the API catches up.
    const activeSource = user?.activity_source_effective;
    const showSourceButton = (linked, source) => linked && (activeSource === undefined || activeSource === source);
    const dispatch = useDispatch();
    const [triggerStravaSync, { isFetching: stravaSyncIsFetching, error: stravaSyncError, isSuccess: stravaSyncIsSuccess }] = useLazySyncStravaQuery();
    const [triggerGarminSync, { isFetching: garminSyncIsFetching, error: garminSyncError, isSuccess: garminSyncIsSuccess }] = useLazySyncGarminQuery();
    const [triggerHealthSync, { isFetching: healthSyncIsFetching, error: healthSyncError, isSuccess: healthSyncIsSuccess }] = useLazySyncHealthQuery();

    // Only the 5 most recent workouts, newest first.
    const recentWorkouts = useMemo(
        () => [...(workouts || [])]
            .sort((a, b) => (b.start_datetime_fmt?.epoch || 0) - (a.start_datetime_fmt?.epoch || 0))
            .slice(0, 5),
        [workouts]
    );

    function handleSyncResult(isSuccess, error, provider) {
        if (isSuccess) {
            dispatch(workoutsApi.util.invalidateTags(['Workout']));
            dispatch(usersApi.util.invalidateTags(['User']));
            dispatch(statsApi.util.invalidateTags(['Stats']));
            dispatch(feedApi.util.invalidateTags(['Feed']));
        } else if (error) {
            dispatch(workoutsApi.util.invalidateTags(['Workout']));
            dispatch(usersApi.util.invalidateTags(['User']));
            if (error?.status === 429) {
                notice(`${error?.data?.message}`);
            } else {
                notice(`${provider} sync failed! ${error?.data?.message || "Unknown error. Please try again later."}`);
            }
        }
    }

    useEffect(() => {
        if (stravaSyncIsFetching === false) handleSyncResult(stravaSyncIsSuccess, stravaSyncError, "Strava");
    }, [stravaSyncIsFetching]);

    useEffect(() => {
        if (garminSyncIsFetching === false) handleSyncResult(garminSyncIsSuccess, garminSyncError, "Garmin");
    }, [garminSyncIsFetching]);

    useEffect(() => {
        if (healthSyncIsFetching === false) handleSyncResult(healthSyncIsSuccess, healthSyncError, "Health");
    }, [healthSyncIsFetching]);

    return (
        <BoxSection>

            <SectionHead title="Latest workouts" hint="Last 5">
                {!stravaLinked && !garminLinked && !healthLinked && (
                    <SyncChip onClick={() => setShowSettings(true)} short="Link" long="Link a service"/>
                )}
                {showSourceButton(stravaLinked, 'strava') && (
                    <SyncChip onClick={() => triggerStravaSync()} isLoading={stravaSyncIsFetching} short="Sync" long="Sync Strava"/>
                )}
                {showSourceButton(garminLinked, 'garmin') && (
                    <SyncChip onClick={() => triggerGarminSync()} isLoading={garminSyncIsFetching} short="Sync" long="Sync Garmin"/>
                )}
                {showSourceButton(healthLinked, 'health') && (
                    <SyncChip onClick={async () => { await nativeHealthKickSync({daysBack: 3}); triggerHealthSync(); }}
                              isLoading={healthSyncIsFetching} short="Sync" long="Sync Health"/>
                )}
            </SectionHead>

            {recentWorkouts.length === 0 ? (
                <EmptyState title="No workouts yet"
                            body="Log this week's first session — the coach is waiting."
                            actionLabel="Log a workout"
                            onAction={() => setShowEditWorkoutModal(true)}/>
            ) : (
                <ul className="divide-y divide-gray-100 dark:divide-ink-700/60 mt-1">
                    {recentWorkouts.map((workout) => {
                        const isSteps = workout.sport_type === "Steps";
                        const primary = isSteps
                            ? `${workout.steps?.toLocaleString() || 0} steps`
                            : (workout.duration || "").substring(0, 5);
                        return (
                            <li key={workout.id}>
                                <button type="button" onClick={() => setShowEditWorkoutModal(workout.id)} className={rowClass}>
                                    <div className="h-10 w-10 rounded-2xl bg-volt-400/15 flex items-center justify-center shrink-0">
                                        <Dumbbell className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold truncate">{sportLabelShort(workout.sport_type)} · {primary}</p>
                                        <p className="text-xs text-gray-400">{workout.start_datetime_fmt?.date_readable}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {!isSteps && workout.distance ? <Chip>{workout.distance} km</Chip> : null}
                                        {!isSteps && workout.kcal ? <Chip>{Math.round(workout.kcal).toLocaleString()} kcal</Chip> : null}
                                    </div>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {(showEditWorkoutModal) && (
                <WorkoutForm setModalState={setShowEditWorkoutModal} id={showEditWorkoutModal} scaling_distance={parseFloat(user?.scaling_distance || "1.0")}/>
            )}

            {/* "Link a Service" opens the personal settings - all import
                providers (Strava, Garmin, Apple/Google Health) link there. */}
            {showSettings && user && (
                <SettingsForm user={user} setModalState={setShowSettings} setLinkStrava={setLinkStrava}/>
            )}

        </BoxSection>
    )
}


function CompetitionRow({competition, user}) {
    const pollSlow = usePollingInterval(90000);

    const {
        data: stats,
        isLoading: statsLoading,
        error: statsError,
    } = useGetStatsByIdQuery(competition.id, {
        pollingInterval: pollSlow,
    });

    const [teamId, setTeamId] = useState(undefined);
    useEffect(() => {
        if (stats?.teams && user?.my_teams) {
            const tmpTeamId = Object.keys(stats?.teams).find(item => user?.my_teams.includes(parseInt(item)));
            setTeamId(tmpTeamId);
        }
    }, [stats, user])

    const navigate = useNavigate();
    const handleClick = (id) => {
        return navigate(`/competition/${id}`);
    }

    const rank = stats?.users?.[user.id]?.rank;
    const started = stats?.competition?.start_date_count >= 0;

    return (
        <li>
            <button type="button" onClick={() => handleClick(competition.id)} className={rowClass}>
                <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{competition.name}</p>
                    <p className="text-xs text-gray-400">{competition.start_date_fmt} – {competition.end_date_fmt}</p>
                </div>
                <div className="shrink-0 text-right">
                    {statsLoading ? (
                        <BeatLoader color={VOLT} size={6}/>
                    ) : (statsError || !stats?.competition) ? (
                        <span className="text-gray-400 text-sm">—</span>
                    ) : !started ? (
                        <span className="text-xs text-gray-400">Not started</span>
                    ) : rank == null ? (
                        <span className="text-xs font-semibold text-volt-600 dark:text-volt-300">Time to work out!</span>
                    ) : (
                        <>
                            <p className="font-display text-xl text-volt-600 dark:text-volt-400 leading-none">#{rank}</p>
                            {competition.has_teams && stats.teams[teamId]?.rank != null && (
                                <Chip>Team #{stats.teams[teamId].rank}</Chip>
                            )}
                        </>
                    )}
                </div>
            </button>
        </li>
    )
}



function CompetitionsBox({user, competitions, setJoinCompetition}) {

    const [showEditCompetitionModal, setShowEditCompetitionModal] = useState(false);

    return (
        <BoxSection additionalClasses={"mb-4"}>

            <SectionHead title="My challenges">
                <JoinButton additionalClasses="my-0.5 sm:my-0" onClick={() => setJoinCompetition(true)}/>
                <AddButton additionalClasses="my-0.5 sm:my-0" label={"Create"}
                           onClick={() => setShowEditCompetitionModal(true)}/>
            </SectionHead>

            {competitions.length === 0 ? (
                <EmptyState title="No challenges yet"
                            body="Create one, or join with a code from a friend."
                            actionLabel="Create a challenge"
                            onAction={() => setShowEditCompetitionModal(true)}/>
            ) : (
                <ul className="divide-y divide-gray-100 dark:divide-ink-700/60 mt-1">
                    {competitions.map((competition) => (
                        <CompetitionRow key={competition.id} competition={competition} user={user} />
                    ))}
                </ul>
            )}

            {(showEditCompetitionModal) && (
                <CompetitionForm setModalState={setShowEditCompetitionModal}/>
            )}

        </BoxSection>
    )
}


function getLast5WeeksRange() {
    let cnt = 35;
    const today = new Date();
    const currentDay = today.getDay(); // 0 (Sun) - 6 (Sat)
    const isMonday = currentDay === 1;

    // Find this week's Monday
    const thisMonday = new Date(today);
    const diffToMonday = (currentDay === 0 ? -6 : 1) - currentDay;
    thisMonday.setDate(today.getDate() + diffToMonday);

    // Find Monday 5 weeks ago
    const start = new Date(thisMonday);
    // If today is Monday, subtract 35 days (5 weeks), otherwise subtract 28 days (4 weeks)
    start.setDate(thisMonday.getDate() - (isMonday ? 35 : 28));

    // Find this week's Sunday
    const end = new Date(thisMonday);
    end.setDate(thisMonday.getDate() + 6); // Sunday of this week

    // Collect all dates
    const dates = [];
    const current = new Date(start);

    while (current <= end) {
        const offset = Math.floor((current - today) / (1000 * 60 * 60 * 24));
        dates.push({
            date: current.toLocaleDateString('en-CA'), // Canadian locale uses YYYY-MM-DD format by default
            week: Math.floor((cnt - 1) / 7) * (-1),
            offset: offset,
            dateObj: new Date(current),
            day: current.getDate(),          // Add day number (1-31)
            month: current.getMonth() + 1,   // Add month number (1-12)
            year: current.getFullYear(),     // Add year number (e.g., 2025)
            monthStr: current.toLocaleDateString('en-US', {month: 'short'}), // Jan, Feb, ...
        });
        current.setDate(current.getDate() + 1);
        cnt--;
    }

    return dates;
}


function ThirtyDayStats({thirtyDayStats}) {
    return (
        <div className="w-full">
            <div className="flex pb-2 items-center">
                <span className="font-display text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    30 Day Activity <span className="font-sans normal-case font-normal">• {thirtyDayStats.startDate} - {thirtyDayStats.endDate}</span>
                </span>
            </div>
            <div className="flex items-end px-2 pt-1 pb-3">
                <span className="font-display text-7xl leading-none text-volt-500 dark:text-volt-400">{thirtyDayStats.activeDays}</span>
                <span className="uppercase text-xs tracking-[0.2em] text-gray-400 pb-1.5 pl-3">active<br/>days</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="flex items-center gap-3 rounded-2xl bg-gray-50 dark:bg-ink-900 border border-gray-200/60 dark:border-ink-700/60 p-3">
                    <Dumbbell className="w-5 h-5 text-volt-600 dark:text-volt-400 shrink-0"/>
                    <div className="text-left">
                        <div className="text-[11px] tracking-wide text-gray-500">Workouts</div>
                        <div className="text-xl font-bold leading-tight">{thirtyDayStats.workouts}</div>
                    </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl bg-gray-50 dark:bg-ink-900 border border-gray-200/60 dark:border-ink-700/60 p-3">
                    <Timer className="w-5 h-5 text-volt-600 dark:text-volt-400 shrink-0"/>
                    <div className="text-left">
                        <div className="text-[11px] tracking-wide text-gray-500">Time</div>
                        <div className="text-xl font-bold leading-tight">{Math.floor(thirtyDayStats.time / 3600).toLocaleString()}<span className="text-sm font-semibold">hr </span>{Math.floor((thirtyDayStats.time % 3600) / 60)}<span className="text-sm font-semibold">min</span></div>
                    </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl bg-gray-50 dark:bg-ink-900 border border-gray-200/60 dark:border-ink-700/60 p-3">
                    <Flame className="w-5 h-5 text-volt-600 dark:text-volt-400 shrink-0"/>
                    <div className="text-left">
                        <div className="text-[11px] tracking-wide text-gray-500">Calories</div>
                        <div className="text-xl font-bold leading-tight">{thirtyDayStats.kcal.toLocaleString()}<span className="text-sm font-semibold">kcal</span></div>
                    </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl bg-gray-50 dark:bg-ink-900 border border-gray-200/60 dark:border-ink-700/60 p-3">
                    <Ruler className="w-5 h-5 text-volt-600 dark:text-volt-400 shrink-0"/>
                    <div className="text-left">
                        <div className="text-[11px] tracking-wide text-gray-500">Distance</div>
                        <div className="text-xl font-bold leading-tight">{Math.round(thirtyDayStats.distance).toLocaleString()}<span className="text-sm font-semibold">km</span></div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function SevenDayStats({sevenDayStats, user}) {

    const [showEditGoalsModal, setShowEditGoalsModal] = useState(false);

    if (sevenDayStats.length === 0) return null;

    return (
        <div className="w-full mt-5">
            <div className="flex flex-col items-start justify-between sm:flex-row sm:items-center gap-2 pb-2">
                <span className="font-display text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Personal Goals <span className="font-sans normal-case font-normal">• 7 Days Rolling</span>
                </span>
                <ModifyGoalsButton additionalClasses="sm:my-0" onClick={() => setShowEditGoalsModal(true)}
                                   label={"Update Goals"}/>
            </div>

            <div className="flex flex-col sm:overflow-x-auto sm:flex-row gap-2">
                {sevenDayStats.map((goal, idx) => (
                    <div key={idx} className="flex-1 rounded-2xl bg-gray-50 dark:bg-ink-900 border border-gray-200/60 dark:border-ink-700/60 p-4">
                        <div className="flex flex-col text-left">
                            <div className="tracking-wide text-gray-500 text-sm mb-0.5">{goal.name}</div>
                            <div className="text-2xl font-display text-volt-500 dark:text-volt-400 text-left mb-2">
                                {goal.value.toLocaleString()} <span className="text-lg text-gray-400">/ {goal.target.toLocaleString()}{goal.unit}</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-ink-700 rounded-full h-2.5">
                                <div className="h-2.5 rounded-full bg-volt-500 dark:bg-volt-400 transition-all" style={{
                                    width: Math.min(goal.value / goal.target * 100, 100) + '%',
                                }}></div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {(showEditGoalsModal) && <PersonalGoalsForm user={user} setModalState={setShowEditGoalsModal}/>}

        </div>
    )
}


function StreakCard({workouts}) {

    const [weekStreak, setWeekStreak] = useState(0);
    const [activeWeekdays, setActiveWeekdays] = useState(new Set());
    const [weekMinutes, setWeekMinutes] = useState(0);

    useEffect(() => {
        const filteredWorkouts = lodFilter(workouts || [], item => item.sport_type !== 'Steps');
        const workoutsPerWeek = lodMapvalues(lodGroupby(filteredWorkouts || [], 'start_datetime_fmt.weeksAgo'), items => lodSumby(items, 'duration_seconds'));

        // streak number (consecutive weeks with at least one workout)
        let streak = -1;
        let i = -1;
        let stillStreak = true;
        while (stillStreak) {
            if (workoutsPerWeek[i + 1] > 0) {
                streak++;
            } else if (i !== -1) {
                stillStreak = false;
            }
            i++;
        }
        setWeekStreak(streak + 1);

        // this week's active weekdays + minutes
        const thisWeek = lodFilter(filteredWorkouts, item => item.start_datetime_fmt.weeksAgo === 0);
        setActiveWeekdays(new Set(thisWeek.map(w => (new Date(w.start_datetime).getDay() + 6) % 7))); // Mon=0 .. Sun=6
        setWeekMinutes(Math.round(lodSumby(thisWeek, item => +item.duration_seconds || 0) / 60));
    }, [workouts]);

    const whoGoalHit = weekMinutes >= 150;

    return (
        <div className="relative overflow-hidden rounded-3xl bg-ink-900 text-white border border-ink-700/60 shadow-card-dark p-5 w-full xl:w-72 shrink-0">
            <div className="pointer-events-none absolute -top-14 -right-14 h-40 w-40 rounded-full bg-volt-400/25 blur-3xl"/>
            <div className="relative">
                <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-volt-400/15 flex items-center justify-center">
                        <Flame className="h-7 w-7 text-volt-400"/>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="font-display text-5xl text-volt-400">{weekStreak}</span>
                        <span className="uppercase text-xs tracking-[0.2em] text-gray-400">week<br/>streak</span>
                    </div>
                </div>

                {/* this week's days */}
                <div className="mt-5 flex justify-between">
                    {["M", "T", "W", "T", "F", "S", "S"].map((label, idx) => {
                        const active = activeWeekdays.has(idx);
                        const isToday = (new Date().getDay() + 6) % 7 === idx;
                        return (
                            <div key={idx} className="flex flex-col items-center gap-1.5">
                                <span className="text-[10px] font-bold text-gray-500">{label}</span>
                                <span className={"h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition " +
                                    (active
                                        ? "bg-volt-400 text-ink-950 shadow-glow-volt"
                                        : "bg-ink-700/60 text-gray-500") +
                                    (isToday ? " ring-2 ring-white/70 ring-offset-2 ring-offset-ink-900" : "")}>
                                    {active ? <Check className="h-4 w-4"/> : label}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-4 flex items-center justify-between text-xs">
                    <span className="text-gray-400">This week</span>
                    <span className={"inline-flex items-center gap-1 font-bold " + (whoGoalHit ? "text-volt-400" : "text-gray-300")}>
                        {whoGoalHit && <CheckCheck className="h-3.5 w-3.5"/>}
                        {weekMinutes} / 150 min
                    </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-ink-700/60 overflow-hidden">
                    <div className="h-full rounded-full bg-volt-400 transition-all"
                         style={{width: Math.min(weekMinutes / 150 * 100, 100) + "%"}}/>
                </div>
            </div>
        </div>
    );
}


function StatsBox({workouts, user}) {

    const [thirtyDayStats, setThirtyDayStats] = useState({activeDays: 0, workouts: 0, distance: 0, kcal: 0, time: 0});
    const [sevenDayStats, setSevenDayStats] = useState([]);
    const last5WeeksList = useMemo(getLast5WeeksRange, []);

    useEffect(() => {
        // 30 day stats
        const filtered30Days = lodFilter(workouts || [], item => item.start_datetime_fmt.days_ago < 30 && item.sport_type !== 'Steps');
        setThirtyDayStats({
            activeDays: lodUniqby(filtered30Days, 'start_datetime_fmt.date_iso').length,
            workouts: filtered30Days.length,
            distance: Math.round(lodSumby(filtered30Days, item => +item.distance || 0) * 10) / 10,
            kcal: Math.round(lodSumby(filtered30Days, item => +item.kcal || 0)),
            time: Math.round(lodSumby(filtered30Days, item => +item.duration_seconds || 0)),
            startDate: lodFind(last5WeeksList, {offset: -29})?.dateObj?.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            }),
            endDate: lodFind(last5WeeksList, {offset: 0})?.dateObj?.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            }),
        })

        // 7 day goals
        const filtered7Days = lodFilter(workouts || [], item => item.start_datetime_fmt.days_ago < 7 && item.sport_type !== 'Steps');
        let newGoals = [];
        if (user.goal_active_days !== null) {
            newGoals.push({
                name: 'Active Days',
                value: lodUniqby(filtered7Days, 'start_datetime_fmt.date_iso').length,
                target: user.goal_active_days,
                unit: ''
            });
        }
        if (user.goal_workout_minutes !== null) {
            newGoals.push({
                name: 'Time Goal',
                value: Math.round(lodSumby(filtered7Days, item => +item.duration_seconds || 0) / 60),
                target: user.goal_workout_minutes,
                unit: 'min'
            });
        }
        if (user.goal_distance !== null) {
            newGoals.push({
                name: 'Distance',
                value: Math.round(lodSumby(filtered7Days, item => +item.distance || 0)),
                target: user.goal_distance,
                unit: 'km'
            });
        }
        setSevenDayStats(newGoals);
    }, [workouts, user]);

    return (
        <div className="w-full flex flex-col xl:flex-row gap-4">
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <ThirtyDayStats thirtyDayStats={thirtyDayStats}/>
                <SevenDayStats sevenDayStats={sevenDayStats} user={user}/>
            </div>
            <StreakCard workouts={workouts}/>
        </div>
    )
}


// Sideload update banner (native app only): the server's published APK
// is newer than the installed build - tap to download & install over
// the top (data kept; same signing key required).
function ApkUpdateBanner() {
    const {update, dismiss} = useApkUpdateInfo();
    if (!update) return null;
    return (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-ink-900 text-white border border-volt-500/40 shadow-card-dark p-4">
            <Download className="h-5 w-5 text-volt-400 shrink-0"/>
            <div className="flex-1 min-w-0">
                <p className="font-display text-xs uppercase tracking-wider">App update available</p>
                <p className="text-[11px] text-gray-400">Version {update.versionName} — installing over the top keeps everything.</p>
            </div>
            <a href={apkDownloadHref()}
                   rel="noopener noreferrer"
                   className="shrink-0 rounded-full bg-volt-400 text-ink-950 px-4 py-2 text-xs font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt">
                Get it
            </a>
            <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-gray-500 hover:text-gray-300 transition">
                <X className="h-4 w-4"/>
            </button>
        </div>
    );
}


export default function MySpace() {
    const pollSlow = usePollingInterval(90000);
    const pollFast = usePollingInterval(60000);
    const navType = useNavigationType();
    useEffect(() => {
        if (navType === "POP") {
            document.body.classList.remove("body-no-scroll");
        }
    }, [navType]);

    const {
        data: user,
        error: userError,
        isLoading: userLoading,
    } = useGetUserByIdQuery('me');

    const {
        data: workouts,
        error: workoutsError,
        isLoading: workoutsIsLoading,
    } = useGetWorkoutsQuery(undefined, {
        pollingInterval: pollFast,
    });

    const {
        data: competitions,
        error: competitionError,
        isLoading: competitionLoading,
    } = useGetCompetitionsQuery(undefined, {
        pollingInterval: pollFast,
    });

    const [searchParams, setSearchParams] = useSearchParams();
    const {search} = useLocation();
    const query = new URLSearchParams(search);
    const searchTermJoin = query.get('join'); // null if not present

    const [linkStrava, setLinkStrava] = useState(false);
    const [joinCompetition, setJoinCompetition] = useState(false);

    // ?action=log opens the workout form directly (PWA home-screen shortcut).
    const [quickLog, setQuickLog] = useState(query.get('action') === 'log');

    useEffect(() => {
        if (searchTermJoin !== null && joinCompetition === false) {
            setJoinCompetition(searchTermJoin);
            searchParams.delete('join');
            setSearchParams(searchParams);
        }
    }, [searchTermJoin, joinCompetition])


    if (userError) {
        console.error('Error retrieving user:', userError);
        return <PageWrapper additionClasses="h-screen flex items-center justify-center"><ErrorBoxSection
            errorMsg={userError?.status + ' / ' + (userError?.error || userError?.message || userError?.data?.detail)}/></PageWrapper>;
    }

    return (
        <PageWrapper>

            <div className="container mx-auto p-4">
                <ApkUpdateBanner/>
                <div className="w-full">

                    {
                        (userLoading || workoutsIsLoading) ? (
                            <SectionLoader height={"h-48 mb-4"}/>
                        ) : (userError) ? (
                            <ErrorBoxSection additionalClasses="mb-4"
                                             errorMsg={userError?.status + ' / ' + (userError?.error || userError?.message || userError?.data?.detail)}/>
                        ) : (
                            <WelcomeBox user={user} workouts={workouts}/>
                        )
                    }

                </div>

                {/* Stats (30 Day Activity, goals, streak) + Competitions -
                    above the workout list so the activity summary is the
                    first thing after the welcome block */}
                <div className="w-full flex flex-col xl:flex-row">
                    <div className="w-full xl:w-2/3 xl:mr-2 mb-4">

                        {
                            (userLoading || workoutsIsLoading) ? (
                                <SectionLoader height={"w-full h-80 mb-4"}/>
                            ) : (workoutsError) ? (
                                <ErrorBoxSection additionalClasses="mb-4"
                                                 errorMsg={workoutsError?.status + ' / ' + (workoutsError?.error || workoutsError?.message || workoutsError?.data?.detail)}/>
                            ) : (
                                <BoxSection additionalClasses="h-full">
                                    <StatsBox workouts={workouts} user={user}/>
                                </BoxSection>
                            )
                        }

                    </div>
                    <div className="w-full xl:w-1/3 xl:ml-2 mb-4">

                        {
                            (userLoading || competitionLoading) ? (
                                <SectionLoader/>
                            ) : (competitionError) ? (
                                <ErrorBoxSection additionalClasses="mb-4"
                                                 errorMsg={competitionError?.status + ' / ' + (competitionError?.error || competitionError?.message || competitionError?.data?.detail)}/>
                            ) : (
                                <CompetitionsBox user={user} competitions={competitions} setJoinCompetition={setJoinCompetition}/>
                            )
                        }

                    </div>
                </div>

                {/* My Workouts - the 5 most recent trainings */}
                <div className="w-full mb-4">
                    {
                        (userLoading || workoutsIsLoading) ? (
                            <SectionLoader height={"h-80"}/>
                        ) : (workoutsError) ? (
                            <ErrorBoxSection
                                errorMsg={workoutsError?.status + ' / ' + (workoutsError?.error || workoutsError?.message || workoutsError?.data?.detail)}/>
                        ) : (
                            <WorkoutsBox workouts={workouts} user={user} setLinkStrava={setLinkStrava}/>
                        )
                    }
                </div>
            </div>

            {linkStrava && <LinkStravaScreen setModal={setLinkStrava}/>}
            {joinCompetition && <JoinCompetitionForm setModalState={setJoinCompetition} join_code={searchTermJoin}/>}
            {quickLog && user && (
                <WorkoutForm setModalState={setQuickLog}
                             scaling_distance={parseFloat(user?.scaling_distance || "1.0")}/>
            )}

        </PageWrapper>
    )
}
import React, {useEffect, useMemo, useState} from "react";
import {
    Check,
    CheckCheck,
    Dumbbell,
    Flame,
    Timer,
    Ruler,
} from 'lucide-react';
import {useGetWorkoutsQuery, useGetWorkoutSummaryQuery, workoutsApi} from "../utils/reducers/workoutsSlice";
import WorkoutForm, {sportLabelShort} from "../forms/workoutForm";
import lodFilter from 'lodash/filter';
import lodFind from 'lodash/find';
import lodGroupby from 'lodash/groupBy';
import lodMapvalues from 'lodash/mapValues';
import lodSumby from 'lodash/sumBy';
import lodUniqby from 'lodash/uniqBy';
import {topSportCounts} from "../utils/sportCounts";
import {useGetUserByIdQuery, usersApi} from "../utils/reducers/usersSlice";
import {useGetCompetitionsQuery} from "../utils/reducers/competitionsSlice";
import {useGetDrillConfigsQuery} from "../utils/reducers/drillInstructorSlice";
import CompetitionForm from "../forms/competitionForm";
import PersonalGoalsForm from "../forms/personalGoalsForm";
import {useLocation, useNavigate, useNavigationType, useSearchParams} from "react-router-dom";
import JoinCompetitionForm from "../forms/joinCompetitionForm";
import SettingsForm from "../forms/settingsForm";
import {LinkStravaScreen} from "./HowTo";
import {
    AddButton,
    JoinButton,
    Modal,
    ModifyGoalsButton,
} from "../forms/basicComponents";
import {BoxSection, ErrorBoxSection, PageWrapper} from "../utils/miscellaneous";
import {SectionLoader} from "../utils/loaders";
import {useDispatch} from "react-redux";
import {useSyncGarminMutation, useSyncStravaMutation, useSyncHealthMutation} from "../utils/reducers/linkSlice";
import {nativeHealthKickSync} from "../utils/nativeHealth";
import {statsApi} from "../utils/reducers/statsSlice";
import {feedApi} from "../utils/reducers/feedSlice";
import {clearBodyScrollLock} from "../utils/overlay";
import ProfileAvatar from "../components/ProfileAvatar";
import {DogTagRow} from "../components/gameBits";
import {Chip, EmptyState, SectionHead, SyncChip, rowClass} from "../components/uiBits";
import usePollingInterval from "../utils/usePollingInterval";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";
import {ReleaseSpark} from "../components/WhatsNew";


const HAND_LOG_KEY = "wc_log_by_hand";

function GettingStarted({user, competitions, workouts, configs, onJoin, onCreate, onSettings, onOpenChallenge}) {
    const list = competitions || [];
    const hasChallenge = list.length > 0;
    const linked = Boolean(user?.strava_athlete_id || user?.garmin_email || user?.health_user_id);
    const [hand, setHand] = useState(() => {
        try { return localStorage.getItem(HAND_LOG_KEY) === "1"; } catch { return false; }
    });
    const hasWorkout = (workouts || []).some((w) => w.sport_type !== "Steps");
    const sourceDone = linked || hand || hasWorkout;
    const owns = list.some((c) => c.owner === user?.id);
    const coachOn = (configs || []).some((c) => c.enabled);
    const coachDone = coachOn || !owns;
    if (hasChallenge && sourceDone && coachDone) return null;

    const btn = "inline-flex items-center rounded-full bg-volt-400 text-ink-950 px-4 py-2 text-xs font-bold uppercase tracking-wide hover:bg-volt-300 transition min-h-[44px]";
    const ghost = "inline-flex items-center rounded-full border border-volt-500/40 text-volt-700 dark:text-volt-300 px-4 py-2 text-xs font-bold uppercase tracking-wide hover:bg-volt-400/10 transition min-h-[44px]";

    function Step({done, n, title, body, children}) {
        return (
            <li className="flex gap-3 py-2.5">
                <span className={"shrink-0 mt-0.5 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold " +
                    (done ? "bg-volt-400 text-ink-950" : "bg-ink-950/8 text-volt-800 dark:bg-ink-900 dark:text-volt-400")}>
                    {done ? <Check className="h-3.5 w-3.5"/> : n}
                </span>
                <div className="min-w-0 flex-1">
                    <p className={"text-sm font-bold " + (done ? "text-gray-400 line-through" : "")}>{title}</p>
                    {!done && body && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{body}</p>}
                    {!done && children}
                </div>
            </li>
        );
    }

    return (
        <BoxSection additionalClasses="mb-4">
            <SectionHead title="Get started"/>
            <ol className="mt-1 divide-y divide-gray-100 dark:divide-ink-700/60">
                <Step done={hasChallenge} n="1" title="Join or create a challenge"
                      body="That's the league you score in with friends.">
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className={btn} onClick={onJoin}>Join</button>
                        <button type="button" className={ghost} onClick={onCreate}>Create</button>
                    </div>
                </Step>
                <Step done={sourceDone} n="2" title="Bring in workouts"
                      body="Connect Strava, Garmin or Health — or log each session yourself.">
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className={btn} onClick={onSettings}>Connect a device</button>
                        <button type="button" className={ghost} onClick={() => {
                            try { localStorage.setItem(HAND_LOG_KEY, "1"); } catch { /* private mode */ }
                            setHand(true);
                        }}>I'll log by hand</button>
                    </div>
                </Step>
                {owns && (
                    <Step done={coachOn} n="3" title="Turn the coach on"
                          body="Open your challenge, go to Feed, and tap Activate.">
                        <div className="mt-2">
                            <button type="button" className={btn} onClick={() => {
                                const owned = list.find((c) => c.owner === user?.id);
                                if (owned) onOpenChallenge(owned.id);
                            }}>Open challenge</button>
                        </div>
                    </Step>
                )}
            </ol>
        </BoxSection>
    );
}


function WelcomeBox({user, workouts, summary}) {
    // Lifetime counts come from the server-side summary endpoint - the
    // loaded workouts page (latest 40) is only the fallback while it
    // loads, so the total is never silently under-counted.
    const fallback = useMemo(() => topSportCounts(workouts, "sport_type"), [workouts]);
    const countTotal = summary?.total_count ?? fallback.total;
    const countGroups = summary?.by_sport ? Object.fromEntries(summary.by_sport) : fallback.groups;
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
                    <p className="text-xs text-gray-600 dark:text-gray-400">Welcome back,</p>
                    <h1 className="text-xl font-display uppercase tracking-wide truncate">{user.first_name}</h1>
                    <DogTagRow tags={user.dog_tags}/>
                    <div className="mt-1 empty:hidden"><ReleaseSpark/></div>
                </div>
                <div className="flex items-baseline gap-1.5 shrink-0 ml-auto sm:ml-0">
                    <span className="text-2xl font-display text-volt-500 dark:text-volt-400">{countTotal}</span>
                    <span className="uppercase text-xs tracking-wide text-gray-500">workouts</span>
                </div>
                {Object.entries(countGroups).map(([label, count], index) => (
                    <div key={"stat" + index} className="hidden lg:flex lg:flex-col lg:items-center shrink-0 px-1">
                        <span className="text-lg font-semibold leading-tight">{count}</span>
                        <span className="uppercase text-xs tracking-wide text-gray-500">{sportLabelShort(label)}</span>
                    </div>
                ))}
            </div>
        </BoxSection>
    )
}


const WORKOUT_PREVIEW = 5;

function workoutDayLabel(workout) {
    const ago = workout.start_datetime_fmt?.days_ago;
    if (ago === 0) return "Today";
    if (ago === 1) return "Yesterday";
    return workout.start_datetime_fmt?.date_readable || "";
}

function groupWorkoutsByDay(items) {
    const groups = [];
    for (const workout of items) {
        const key = workout.start_datetime_fmt?.date_iso || "unknown";
        const last = groups[groups.length - 1];
        if (!last || last.key !== key) {
            groups.push({key, label: workoutDayLabel(workout), items: [workout]});
        } else {
            last.items.push(workout);
        }
    }
    return groups;
}

function WorkoutRow({workout, onOpen, showDate = true}) {
    const isSteps = workout.sport_type === "Steps";
    const primary = isSteps
        ? `${workout.steps?.toLocaleString() || 0} steps`
        : (workout.duration || "").substring(0, 5);
    return (
        <li>
            <button type="button" onClick={() => onOpen(workout.id)} className={rowClass}>
                <div className="h-10 w-10 rounded-2xl bg-volt-400/15 flex items-center justify-center shrink-0">
                    <Dumbbell className="h-4 w-4 text-volt-600 dark:text-volt-400"/>
                </div>
                <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{sportLabelShort(workout.sport_type)} · {primary}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {showDate
                            ? workout.start_datetime_fmt?.date_readable
                            : workout.start_datetime_fmt?.time_24h}
                    </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {!isSteps && workout.distance ? <Chip>{Math.round(workout.distance * 10) / 10} km</Chip> : null}
                    {!isSteps && workout.kcal ? <Chip>{Math.round(workout.kcal).toLocaleString()} kcal</Chip> : null}
                </div>
            </button>
        </li>
    );
}

function WorkoutHistory({initialItems, onOpen}) {
    // The dashboard loads only the latest 40 workouts; the history pages
    // the rest from the server so every activity stays reachable.
    const dispatch = useDispatch();
    const [extra, setExtra] = useState([]);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    const items = useMemo(() => {
        const seen = new Set();
        return [...initialItems, ...extra].filter((w) => {
            if (seen.has(w.id)) return false;
            seen.add(w.id);
            return true;
        });
    }, [initialItems, extra]);

    async function loadMore() {
        setLoadingMore(true);
        try {
            const page = await dispatch(
                workoutsApi.endpoints.getWorkouts.initiate(
                    {limit: 100, offset: items.length},
                    {forceRefetch: true},
                )
            ).unwrap();
            setExtra((cur) => [...cur, ...page]);
            if (page.length < 100) setHasMore(false);
        } catch (err) {
            toast.error(errText(err, "Could not load older activities. Please try again."));
        } finally {
            setLoadingMore(false);
        }
    }

    return (
        <div className="max-h-[70vh] overflow-y-auto -mx-1 px-1">
            {groupWorkoutsByDay(items).map((group) => (
                <section key={group.key} className="mb-2">
                    <h3 className="sticky top-0 z-10 bg-[#efece4]/85 dark:bg-ink-850/95 backdrop-blur px-1 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {group.label}
                    </h3>
                    <ul className="divide-y divide-gray-100 dark:divide-ink-700/60">
                        {group.items.map((workout) => (
                            <WorkoutRow key={workout.id} workout={workout} showDate={false} onOpen={onOpen}/>
                        ))}
                    </ul>
                </section>
            ))}
            {hasMore && (
                <button type="button" onClick={loadMore} disabled={loadingMore}
                        className="mt-3 w-full min-h-[44px] rounded-2xl btn-glass text-sm font-bold uppercase tracking-wide transition disabled:opacity-50">
                    {loadingMore ? "Loading…" : "Load older activities"}
                </button>
            )}
        </div>
    );
}

function WorkoutsBox({workouts, user, setLinkStrava, summary}) {

    const [showEditWorkoutModal, setShowEditWorkoutModal] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
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
    // Syncs are mutations (they must fire on EVERY tap) handled with plain
    // async/await - no effect mirroring of RTK flags.
    const [triggerStravaSync, {isLoading: stravaSyncIsFetching}] = useSyncStravaMutation();
    const [triggerGarminSync, {isLoading: garminSyncIsFetching}] = useSyncGarminMutation();
    const [triggerHealthSync, {isLoading: healthSyncIsFetching}] = useSyncHealthMutation();
    const [healthKickBusy, setHealthKickBusy] = useState(false);

    const sortedWorkouts = useMemo(
        () => [...(workouts || [])]
            .sort((a, b) => (b.start_datetime_fmt?.epoch || 0) - (a.start_datetime_fmt?.epoch || 0)),
        [workouts]
    );
    const recentWorkouts = sortedWorkouts.slice(0, WORKOUT_PREVIEW);
    const older = Math.max(0, sortedWorkouts.length - WORKOUT_PREVIEW);

    function openWorkout(id) {
        setShowHistory(false);
        setShowEditWorkoutModal(id);
    }

    async function runSync(trigger, provider) {
        try {
            const result = await trigger().unwrap();
            dispatch(workoutsApi.util.invalidateTags(['Workout']));
            dispatch(usersApi.util.invalidateTags(['User']));
            dispatch(statsApi.util.invalidateTags(['Stats']));
            dispatch(feedApi.util.invalidateTags(['Feed']));
            toast.success(result?.message || `${provider} sync started.`);
        } catch (error) {
            dispatch(workoutsApi.util.invalidateTags(['Workout']));
            dispatch(usersApi.util.invalidateTags(['User']));
            if (error?.status === 429) {
                toast.error(`${error?.data?.message}`);
            } else {
                toast.error(`${provider} sync failed. ${errText(error, "Please try again later.")}`);
            }
        }
    }

    return (
        <BoxSection>

            <SectionHead title="Latest workouts"
                         hint={sortedWorkouts.length > WORKOUT_PREVIEW ? `Latest ${WORKOUT_PREVIEW} of ${(summary?.total_count ?? sortedWorkouts.length)}` : null}>
                {!stravaLinked && !garminLinked && !healthLinked && (
                    <SyncChip onClick={() => setShowSettings(true)} short="Link" long="Link a service"/>
                )}
                {showSourceButton(stravaLinked, 'strava') && (
                    <SyncChip onClick={() => runSync(triggerStravaSync, "Strava")} isLoading={stravaSyncIsFetching} short="Sync" long="Sync Strava"/>
                )}
                {showSourceButton(garminLinked, 'garmin') && (
                    <SyncChip onClick={() => runSync(triggerGarminSync, "Garmin")} isLoading={garminSyncIsFetching} short="Sync" long="Sync Garmin"/>
                )}
                {showSourceButton(healthLinked, 'health') && (
                    <SyncChip onClick={async () => {
                                  setHealthKickBusy(true);
                                  try {
                                      const kick = await nativeHealthKickSync({daysBack: 14, publicUrl: user?.health_public_url});
                                      if (kick?.reason === "no-session") {
                                          toast.error("Health Connect is not linked in this app - open Settings and reconnect.");
                                          return;
                                      }
                                      await runSync(triggerHealthSync, "Health");
                                  } finally {
                                      setHealthKickBusy(false);
                                  }
                              }}
                              isLoading={healthSyncIsFetching || healthKickBusy} short="Sync" long="Sync Health"/>
                )}
            </SectionHead>

            {recentWorkouts.length === 0 ? (
                <EmptyState title="No workouts yet"
                            body="Log this week's first session — the coach is waiting."
                            actionLabel="Log a workout"
                            onAction={() => setShowEditWorkoutModal(true)}/>
            ) : (
                <>
                    <ul className="divide-y divide-gray-100 dark:divide-ink-700/60 mt-1">
                        {recentWorkouts.map((workout) => (
                            <WorkoutRow key={workout.id} workout={workout} onOpen={openWorkout}/>
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
                    <WorkoutHistory initialItems={sortedWorkouts} onOpen={openWorkout}/>
                </Modal>
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
    // Rank arrives embedded in the competitions payload (my_rank_summary)
    // - no per-row poller for N challenges anymore.
    const summary = competition?.my_rank_summary || null;

    const navigate = useNavigate();
    const handleClick = (id) => {
        return navigate(`/competition/${id}`);
    }

    const rank = summary?.my_rank;
    const started = summary?.started;

    return (
        <li>
            <button type="button" onClick={() => handleClick(competition.id)} className={rowClass}>
                <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{competition.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{competition.start_date_fmt} – {competition.end_date_fmt}</p>
                </div>
                <div className="shrink-0 text-right">
                    {!summary ? (
                        <span className="text-gray-500 dark:text-gray-400 text-sm">—</span>
                    ) : !started ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400">Not started</span>
                    ) : rank == null ? (
                        <span className="text-xs font-semibold text-volt-600 dark:text-volt-300">Time to work out!</span>
                    ) : (
                        <>
                            <p className="font-display text-xl text-volt-600 dark:text-volt-400 leading-none">#{rank}</p>
                            {competition.has_teams && summary.team_rank != null && (
                                <Chip>Team #{summary.team_rank}</Chip>
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
                <div className="flex items-center gap-3 rounded-2xl glass-well p-3">
                    <Dumbbell className="w-5 h-5 text-volt-600 dark:text-volt-400 shrink-0"/>
                    <div className="text-left">
                        <div className="text-[11px] tracking-wide text-gray-500">Workouts</div>
                        <div className="text-xl font-bold leading-tight">{thirtyDayStats.workouts}</div>
                    </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl glass-well p-3">
                    <Timer className="w-5 h-5 text-volt-600 dark:text-volt-400 shrink-0"/>
                    <div className="text-left">
                        <div className="text-[11px] tracking-wide text-gray-500">Time</div>
                        <div className="text-xl font-bold leading-tight">{Math.floor(thirtyDayStats.time / 3600).toLocaleString()}<span className="text-sm font-semibold">hr </span>{Math.floor((thirtyDayStats.time % 3600) / 60)}<span className="text-sm font-semibold">min</span></div>
                    </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl glass-well p-3">
                    <Flame className="w-5 h-5 text-volt-600 dark:text-volt-400 shrink-0"/>
                    <div className="text-left">
                        <div className="text-[11px] tracking-wide text-gray-500">Calories</div>
                        <div className="text-xl font-bold leading-tight">{thirtyDayStats.kcal.toLocaleString()}<span className="text-sm font-semibold">kcal</span></div>
                    </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl glass-well p-3">
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

    // No goals yet: show the entry point instead of vanishing - goal
    // setting was undiscoverable unless you already had goals.
    if (sevenDayStats.length === 0) {
        return (
            <div className="w-full mt-5">
                <div className="rounded-2xl glass-well p-4 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">No personal goals yet</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Set weekly goals for active days, minutes or distance - only you see them.</p>
                    </div>
                    <ModifyGoalsButton additionalClasses="sm:my-0" onClick={() => setShowEditGoalsModal(true)}
                                       label={"Set goals"}/>
                </div>
                {(showEditGoalsModal) && <PersonalGoalsForm user={user} setModalState={setShowEditGoalsModal}/>}
            </div>
        );
    }

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
                    <div key={idx} className="flex-1 rounded-2xl glass-well p-4">
                        <div className="flex flex-col text-left">
                            <div className="tracking-wide text-gray-500 text-sm mb-0.5">{goal.name}</div>
                            <div className="text-2xl font-display text-volt-500 dark:text-volt-400 text-left mb-2">
                                {goal.value.toLocaleString()} <span className="text-lg text-gray-400">/ {goal.target.toLocaleString()}{goal.unit}</span>
                            </div>
                            <div className="w-full bg-ink-950/10 dark:bg-ink-700 rounded-full h-2.5"
                                 role="progressbar" aria-valuemin={0} aria-valuemax={goal.target}
                                 aria-valuenow={Math.min(goal.value, goal.target)}
                                 aria-label={`${goal.name}: ${goal.value} of ${goal.target}${goal.unit}`}>
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


// WHO recommendation: 150 minutes of moderate activity per week.
const WHO_WEEKLY_MINUTES = 150;

function StreakCard({workouts, summary}) {

    // Derived state via useMemo (not effect+setState): one render, no
    // stale-window between prop change and effect run.
    const {weekStreak, activeWeekdays, weekMinutes} = useMemo(() => {
        // Server-computed streak (truthful beyond the latest 40 loaded
        // workouts); the client computation below is only a fallback
        // while the summary is unavailable.
        if (summary) {
            return {
                weekStreak: summary.streak_weeks ?? 0,
                activeWeekdays: new Set(summary.week?.days || []),
                weekMinutes: Math.round((summary.week?.seconds || 0) / 60),
            };
        }
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

        // this week's active weekdays + minutes
        const thisWeek = lodFilter(filteredWorkouts, item => item.start_datetime_fmt.weeksAgo === 0);
        return {
            weekStreak: streak + 1,
            activeWeekdays: new Set(thisWeek.map(w => (new Date(w.start_datetime).getDay() + 6) % 7)), // Mon=0 .. Sun=6
            weekMinutes: Math.round(lodSumby(thisWeek, item => +item.duration_seconds || 0) / 60),
        };
    }, [workouts, summary]);

    const whoGoalHit = weekMinutes >= WHO_WEEKLY_MINUTES;

    return (
        <div className="relative overflow-hidden rounded-3xl glass-card text-ink-950 dark:text-white p-5 w-full xl:w-72 shrink-0">
            <div className="pointer-events-none absolute -top-14 -right-14 h-40 w-40 rounded-full bg-volt-400/25 blur-3xl"/>
            <div className="relative">
                <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-volt-400/20 dark:bg-volt-400/15 flex items-center justify-center">
                        <Flame className="h-7 w-7 text-volt-700 dark:text-volt-400"/>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="font-display text-5xl text-volt-700 dark:text-volt-400">{weekStreak}</span>
                        <span className="uppercase text-xs tracking-[0.2em] text-gray-600 dark:text-gray-400">week<br/>streak</span>
                    </div>
                </div>

                {/* this week's days */}
                <div className="mt-5 flex justify-between">
                    {["M", "T", "W", "T", "F", "S", "S"].map((label, idx) => {
                        const active = activeWeekdays.has(idx);
                        const isToday = (new Date().getDay() + 6) % 7 === idx;
                        return (
                            <div key={idx} className="flex flex-col items-center gap-1.5">
                                <span className="text-[10px] font-bold text-gray-600 dark:text-gray-500">{label}</span>
                                <span className={"h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition " +
                                    (active
                                        ? "bg-volt-400 text-ink-950 shadow-glow-volt"
                                        : "bg-ink-950/8 text-gray-500 dark:bg-ink-700/60") +
                                    (isToday ? " ring-2 ring-volt-600/70 dark:ring-white/70 ring-offset-2 ring-offset-[#efece4] dark:ring-offset-ink-900" : "")}>
                                    {active ? <Check className="h-4 w-4"/> : label}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-4 flex items-center justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400">This week</span>
                    <span className={"inline-flex items-center gap-1 font-bold " + (whoGoalHit ? "text-volt-700 dark:text-volt-400" : "text-gray-700 dark:text-gray-300")}>
                        {whoGoalHit && <CheckCheck className="h-3.5 w-3.5"/>}
                        {weekMinutes} / {WHO_WEEKLY_MINUTES} min
                    </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-ink-950/10 dark:bg-ink-700/60 overflow-hidden"
                     role="progressbar" aria-valuemin={0} aria-valuemax={WHO_WEEKLY_MINUTES}
                     aria-valuenow={Math.min(weekMinutes, WHO_WEEKLY_MINUTES)}
                     aria-label={`This week: ${weekMinutes} of ${WHO_WEEKLY_MINUTES} recommended minutes`}>
                    <div className="h-full rounded-full bg-volt-400 transition-all"
                         style={{width: Math.min(weekMinutes / WHO_WEEKLY_MINUTES * 100, 100) + "%"}}/>
                </div>
            </div>
        </div>
    );
}


function StatsBox({workouts, user, summary}) {

    const last5WeeksList = useMemo(getLast5WeeksRange, []);

    // 30 day stats - server aggregates when available (the loaded page of
    // 40 workouts under-counts anyone with more history). Derived via
    // useMemo: no extra render pass, no stale state.
    const thirtyDayStats = useMemo(() => {
        const startDate = lodFind(last5WeeksList, {offset: -29})?.dateObj?.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
        const endDate = lodFind(last5WeeksList, {offset: 0})?.dateObj?.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
        if (summary?.d30) {
            return {
                activeDays: summary.d30.active_days,
                workouts: summary.d30.workouts,
                distance: summary.d30.distance,
                kcal: summary.d30.kcal,
                time: summary.d30.seconds,
                startDate,
                endDate,
            };
        }
        const filtered30Days = lodFilter(workouts || [], item => item.start_datetime_fmt.days_ago < 30 && item.sport_type !== 'Steps');
        return {
            activeDays: lodUniqby(filtered30Days, 'start_datetime_fmt.date_iso').length,
            workouts: filtered30Days.length,
            distance: Math.round(lodSumby(filtered30Days, item => +item.distance || 0) * 10) / 10,
            kcal: Math.round(lodSumby(filtered30Days, item => +item.kcal || 0)),
            time: Math.round(lodSumby(filtered30Days, item => +item.duration_seconds || 0)),
            startDate,
            endDate,
        };
    }, [workouts, summary, last5WeeksList]);

    // 7 day goals
    const sevenDayStats = useMemo(() => {
        const filtered7Days = lodFilter(workouts || [], item => item.start_datetime_fmt.days_ago < 7 && item.sport_type !== 'Steps');
        const d7ActiveDays = summary?.d7?.active_days ?? lodUniqby(filtered7Days, 'start_datetime_fmt.date_iso').length;
        const d7Minutes = summary?.d7 ? Math.round(summary.d7.seconds / 60) : Math.round(lodSumby(filtered7Days, item => +item.duration_seconds || 0) / 60);
        const d7Distance = summary?.d7?.distance ?? Math.round(lodSumby(filtered7Days, item => +item.distance || 0));
        let newGoals = [];
        if (user.goal_active_days !== null) {
            newGoals.push({
                name: 'Active Days',
                value: d7ActiveDays,
                target: user.goal_active_days,
                unit: ''
            });
        }
        if (user.goal_workout_minutes !== null) {
            newGoals.push({
                name: 'Time Goal',
                value: d7Minutes,
                target: user.goal_workout_minutes,
                unit: 'min'
            });
        }
        if (user.goal_distance !== null) {
            newGoals.push({
                name: 'Distance',
                value: d7Distance,
                target: user.goal_distance,
                unit: 'km'
            });
        }
        return newGoals;
    }, [workouts, user, summary]);

    return (
        <div className="w-full flex flex-col xl:flex-row gap-4">
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <ThirtyDayStats thirtyDayStats={thirtyDayStats}/>
                <SevenDayStats sevenDayStats={sevenDayStats} user={user}/>
            </div>
            <StreakCard workouts={workouts} summary={summary}/>
        </div>
    )
}


export default function MySpace() {
    const pollSlow = usePollingInterval(90000);
    const pollFast = usePollingInterval(60000);
    const navType = useNavigationType();
    useEffect(() => {
        if (navType === "POP") {
            clearBodyScrollLock();
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
    } = useGetWorkoutsQuery({limit: 40}, {
        pollingInterval: pollSlow,
    });

    // Lifetime/30-day aggregates from the server - the loaded page of
    // 40 workouts is too short to compute them truthfully.
    const {data: workoutSummary} = useGetWorkoutSummaryQuery(undefined, {
        pollingInterval: pollSlow,
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
    const [showCreateChallenge, setShowCreateChallenge] = useState(false);
    const [showGettingStartedSettings, setShowGettingStartedSettings] = useState(false);
    const navigate = useNavigate();
    const {data: drillConfigs} = useGetDrillConfigsQuery(undefined, {skip: !user});

    // ?action=log opens the workout form directly (PWA home-screen shortcut).
    const [quickLog, setQuickLog] = useState(query.get('action') === 'log');

    useEffect(() => {
        // Consume one-shot URL params so a refresh does not reopen the
        // modals. ?join=CODE opens the join form, ?action=log the workout
        // form (PWA home-screen shortcut). Work on a fresh copy - the
        // useSearchParams object is shared across effects.
        const next = new URLSearchParams(search);
        let changed = false;
        if (searchTermJoin !== null && joinCompetition === false) {
            setJoinCompetition(searchTermJoin);
            next.delete('join');
            changed = true;
        }
        if (next.get('action') !== null) {
            next.delete('action');
            changed = true;
        }
        if (changed) setSearchParams(next, {replace: true});
    }, [searchTermJoin, joinCompetition])


    if (userError) {
        console.error('Error retrieving user:', userError);
        return <PageWrapper additionClasses="h-screen flex items-center justify-center"><ErrorBoxSection
            errorMsg={errText(userError, 'Could not load your account. Please try again.')}/></PageWrapper>;
    }

    return (
        <PageWrapper>

            <div className="container mx-auto p-4">
                {user && (
                    <GettingStarted
                        user={user}
                        competitions={competitions}
                        workouts={workouts}
                        configs={drillConfigs}
                        onJoin={() => setJoinCompetition(true)}
                        onCreate={() => setShowCreateChallenge(true)}
                        onSettings={() => setShowGettingStartedSettings(true)}
                        onOpenChallenge={(id) => navigate(`/competition/${id}?tab=feed`)}
                    />
                )}
                <div className="w-full">

                    {
                        (userLoading || workoutsIsLoading) ? (
                            <SectionLoader height={"h-48 mb-4"}/>
                        ) : (userError) ? (
                            <ErrorBoxSection additionalClasses="mb-4"
                                             errorMsg={errText(userError, 'Could not load your account. Please try again.')}/>
                        ) : (
                            <WelcomeBox user={user} workouts={workouts} summary={workoutSummary}/>
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
                                                 errorMsg={errText(workoutsError, 'Could not load your workouts. Please try again.')}/>
                            ) : (
                                <BoxSection additionalClasses="h-full">
                                    <StatsBox workouts={workouts} user={user} summary={workoutSummary}/>
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
                                                 errorMsg={errText(competitionError, 'Could not load your challenges. Please try again.')}/>
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
                                errorMsg={errText(workoutsError, 'Could not load your workouts. Please try again.')}/>
                        ) : (
                            <WorkoutsBox workouts={workouts} user={user} setLinkStrava={setLinkStrava} summary={workoutSummary}/>
                        )
                    }
                </div>
            </div>

            {linkStrava && <LinkStravaScreen setModal={setLinkStrava}/>}
            {joinCompetition && <JoinCompetitionForm setModalState={setJoinCompetition} join_code={searchTermJoin}/>}
            {showCreateChallenge && <CompetitionForm setModalState={setShowCreateChallenge}/>}
            {showGettingStartedSettings && user && (
                <SettingsForm user={user} setModalState={setShowGettingStartedSettings} setLinkStrava={setLinkStrava}/>
            )}
            {quickLog && user && (
                <WorkoutForm setModalState={setQuickLog}
                             scaling_distance={parseFloat(user?.scaling_distance || "1.0")}/>
            )}

        </PageWrapper>
    )
}
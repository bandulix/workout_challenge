/** Parse a YYYY-MM-DD (or Date) as a local calendar day. Avoids UTC-midnight off-by-one. */
function parseDateOnly(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfLocalDay(now) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole local calendar days from today until the inclusive end date. 0 = last day. */
export function daysUntilChallengeEnd(endDate, now = new Date()) {
    const end = parseDateOnly(endDate);
    if (!end) return null;
    return Math.round((end.getTime() - startOfLocalDay(now).getTime()) / 86400000);
}

export function challengeDaysLeftLabel(endDate, now = new Date()) {
    const days = daysUntilChallengeEnd(endDate, now);
    if (days == null) return "";
    if (days > 1) return `${days} days left`;
    if (days === 1) return "1 day left";
    if (days === 0) return "Last day";
    return "Ended";
}

/** Chip for the challenge header: a date, Last day, or Ended — not a day-count argument. */
export function challengeEndChip(endDate, endDateFmt, now = new Date()) {
    const days = daysUntilChallengeEnd(endDate, now);
    if (days == null) return null;
    if (days < 0) return {kind: "ended", text: "Ended"};
    if (days === 0) return {kind: "last", text: "Last day"};
    const when = String(endDateFmt || "").trim();
    return {kind: "live", text: when ? `Ends ${when}` : `${days} day${days === 1 ? "" : "s"} left`};
}

/** A challenge is "running" from its start date through the end date (inclusive, plus the last calendar day). */
export function isChallengeRunning(c) {
    if (!c) return false;
    const now = Date.now() / 1000;
    if (c.start_date_epoch && now < c.start_date_epoch) return false;
    if (c.end_date_epoch && now > c.end_date_epoch + 86400) return false;
    return true;
}

/** Prefer the single running challenge; otherwise the only challenge. */
export function primaryChallenge(competitions) {
    const list = Array.isArray(competitions) ? competitions : Object.values(competitions || {});
    if (list.length === 0) return null;
    const running = list.filter(isChallengeRunning);
    if (running.length === 1) return running[0];
    if (list.length === 1) return list[0];
    return null;
}

function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value) {
    const number = finiteNumber(value);
    return number === null || number < 0 ? null : number;
}

function personalGoalModel(user, workoutSummary) {
    const d7 = workoutSummary?.d7 || {};
    const seconds = nonNegativeNumber(d7.seconds);
    const goals = [
        {
            key: "active-days",
            label: "active days",
            target: finiteNumber(user?.goal_active_days),
            current: nonNegativeNumber(d7.active_days),
        },
        {
            key: "workout-minutes",
            label: "minutes",
            target: finiteNumber(user?.goal_workout_minutes),
            current: seconds === null ? null : Math.round(seconds / 60),
        },
        {
            key: "distance",
            label: "km",
            target: finiteNumber(user?.goal_distance),
            current: nonNegativeNumber(d7.distance),
        },
    ].filter((goal) => goal.target !== null && goal.target > 0);

    if (goals.length === 0) return null;

    const incomplete = goals.filter((goal) => goal.current === null || goal.current < goal.target);
    const measuredIncomplete = incomplete
        .filter((goal) => goal.current !== null)
        .sort((a, b) => (b.current / b.target) - (a.current / a.target));
    const goal = measuredIncomplete[0] || incomplete[0] || goals[0];
    const completed = goal.current !== null && goal.current >= goal.target;
    const remaining = goal.current === null ? null : Math.max(0, goal.target - goal.current);

    return {
        kind: "personal-goal",
        goalKey: goal.key,
        goalLabel: goal.label,
        goalTarget: goal.target,
        goalCurrent: goal.current,
        goalRemaining: goal.key === "distance" && remaining !== null ? Math.round(remaining * 10) / 10 : remaining,
        goalCompleted: completed,
    };
}

function suggestedWorkout(goal) {
    if (!goal || goal.goalCompleted || !Number.isFinite(goal.goalRemaining) || goal.goalRemaining <= 0) return null;
    if (goal.goalKey === "workout-minutes") {
        const minutes = Math.min(30, Math.max(5, Math.ceil(Math.min(goal.goalRemaining, 30) / 5) * 5));
        return `a comfortable ${minutes}-minute session`;
    }
    if (goal.goalKey === "distance") {
        const distance = Math.ceil(Math.min(goal.goalRemaining, 2) * 10) / 10;
        return `a comfortable session up to ${distance.toFixed(1)} km`;
    }
    if (goal.goalKey === "active-days") return "one comfortable activity on a day not yet counted";
    return null;
}

const personalGoalMetrics = {"workout-minutes": "min", distance: "km", "active-days": "num"};

function challengeWorkoutSuggestion(competition, personalGoal) {
    const goals = Array.isArray(competition?.goals) ? competition.goals : [];
    const preferredMetric = personalGoalMetrics[personalGoal?.goalKey];
    const supported = goals.filter((goal) => ["min", "km", "num"].includes(String(goal?.metric || "").toLowerCase()));
    const scoreGoal = (preferredMetric && supported.find((goal) => String(goal.metric).toLowerCase() === preferredMetric))
        || (!preferredMetric && supported[0]);
    if (!scoreGoal) return null;

    const metric = String(scoreGoal.metric).toLowerCase();
    const defaultLimit = metric === "km" ? 2 : metric === "num" ? 1 : 30;
    const caps = ["max_per_workout", "max_per_day", "max_per_week"]
        .map((key) => nonNegativeNumber(scoreGoal[key]))
        .filter((value) => value !== null);
    if (caps.includes(0)) return null;
    const limit = Math.min(defaultLimit, ...caps);
    const floors = ["min_per_workout", "min_per_day", "min_per_week"]
        .map((key) => nonNegativeNumber(scoreGoal[key]))
        .filter((value) => value !== null);
    const minimum = Math.max(0, ...floors);
    if (minimum > limit || (metric === "num" && limit < 1)) return null;

    if (metric === "km") {
        const distance = Math.floor(limit * 10) / 10;
        return distance > 0 ? `a comfortable session up to ${distance.toFixed(1)} km` : null;
    }
    if (metric === "num") return "one comfortable eligible activity";
    const minutes = Math.floor(limit);
    return minutes > 0 ? `a comfortable ${minutes}-minute session` : null;
}

/** Build a safe, presentation-ready model for the Home rival card. */
export function challengeRivalCard(competition, {user, workoutSummary} = {}) {
    const summary = competition?.my_rank_summary;
    if (!competition?.id || summary?.started === false) return null;

    const challenge = {
        challengeId: competition.id,
        challengeName: competition.name || "Challenge",
        ...(summary?.gap_changed === true ? {gapChanged: true} : {}),
    };

    if (summary?.started === true && summary.my_rank == null) {
        const goal = personalGoalModel(user, workoutSummary);
        if (goal) {
            const recommendation = suggestedWorkout(goal);
            return {...challenge, ...goal, ...(recommendation ? {suggestedWorkout: recommendation} : {})};
        }
        return {...challenge, kind: "first-workout"};
    }

    if (summary?.started === true && summary.rival) {
        const placesToRival = Number(summary.places_to_rival);
        const rivalUsername = String(summary.rival.username || "").trim();
        const rivalId = Number(summary.rival.id);
        const hasPointsGap = summary.points_to_catch !== null
            && summary.points_to_catch !== undefined && summary.points_to_catch !== "";
        const pointsGap = hasPointsGap ? Number(summary.points_to_catch) : null;
        const pinned = summary.rival_is_pinned === true;
        const gapConsistent = !hasPointsGap || (Number.isFinite(pointsGap)
            && (placesToRival > 0 ? pointsGap > 0
                : pinned && placesToRival < 0 ? pointsGap < 0
                    : pinned && placesToRival === 0 ? pointsGap === 0
                        : false));
        const hasRankPair = summary.my_rank !== null && summary.my_rank !== undefined
            && summary.rival_rank !== null && summary.rival_rank !== undefined;
        const rankPairConsistent = !hasRankPair
            || (Number.isInteger(Number(summary.my_rank))
                && Number.isInteger(Number(summary.rival_rank))
                && Number(summary.my_rank) - Number(summary.rival_rank) === placesToRival);
        if (rivalUsername && Number.isInteger(rivalId) && rivalId > 0
            && Number.isInteger(placesToRival) && gapConsistent && rankPairConsistent) {
            const goal = personalGoalModel(user, workoutSummary);
            const goalFields = goal ? {
                goalKey: goal.goalKey,
                goalLabel: goal.goalLabel,
                goalTarget: goal.goalTarget,
                goalCurrent: goal.goalCurrent,
                goalRemaining: goal.goalRemaining,
                goalCompleted: goal.goalCompleted,
            } : {};
            const challengeSuggestion = challengeWorkoutSuggestion(competition, goal);
            const rivalFields = {
                rivalId,
                rivalUsername,
                rivalIsPinned: summary.rival_is_pinned === true,
                ...goalFields,
                ...(challengeSuggestion ? {suggestedWorkout: challengeSuggestion} : {}),
            };
            if (placesToRival > 0) {
                return {...challenge, kind: "chasing", ...rivalFields, rivalPlacesAhead: placesToRival};
            }
            if (summary.rival_is_pinned === true && placesToRival < 0) {
                return {...challenge, kind: "defending", ...rivalFields, rivalPlacesBehind: Math.abs(placesToRival)};
            }
            if (summary.rival_is_pinned === true && placesToRival === 0) {
                return {...challenge, kind: "tied", ...rivalFields};
            }
        }
    }

    const personalGoal = personalGoalModel(user, workoutSummary);
    if (personalGoal) {
        const recommendation = suggestedWorkout(personalGoal);
        return {...challenge, ...personalGoal, ...(recommendation ? {suggestedWorkout: recommendation} : {})};
    }
    if (summary?.started === true && summary.my_rank === 1) {
        return {...challenge, kind: "leading"};
    }

    // Incomplete or malformed standings should not make the Home prompt
    // disappear or imply a guaranteed pass. A user's configured personal
    // goal takes precedence above; otherwise keep the challenge link useful.
    return {...challenge, kind: "no-rival"};
}

const LAST_COMP_KEY = "wc_last_competition";
let lastCompetitionMemory = "";

export function rememberLastCompetition(pathname) {
    const match = /^\/competition\/(\d+)/.exec(String(pathname || "").replace(/\/+$/, "") || "/");
    if (!match) return;
    lastCompetitionMemory = match[1];
    try {
        window.localStorage.setItem(LAST_COMP_KEY, match[1]);
    } catch {
        /* private mode */
    }
}

/** Last opened challenge that the user still belongs to. */
export function lastChallenge(competitions) {
    const list = Array.isArray(competitions) ? competitions : Object.values(competitions || {});
    if (list.length === 0) return null;
    let stored = lastCompetitionMemory;
    try {
        stored = window.localStorage.getItem(LAST_COMP_KEY) || lastCompetitionMemory;
    } catch {
        /* keep memory */
    }
    return list.find((c) => String(c.id) === stored) || primaryChallenge(list) || list[0] || null;
}

const HOME_RIVAL_PREFS_KEY = "wc_home_rival_preferences_v1";
const homeRivalPrefsMemory = new Map();

function homeRivalPrefsKey(userId) {
    return userId === null || userId === undefined || userId === ""
        ? null
        : `${HOME_RIVAL_PREFS_KEY}:${String(userId)}`;
}

function readHomeRivalPrefs(userId) {
    const key = homeRivalPrefsKey(userId);
    if (!key) return {};
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return homeRivalPrefsMemory.get(key) || {};
        const value = JSON.parse(raw);
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
        return homeRivalPrefsMemory.get(key) || {};
    }
}

function writeHomeRivalPrefs(userId, prefs) {
    const key = homeRivalPrefsKey(userId);
    if (!key) return;
    homeRivalPrefsMemory.set(key, prefs);
    try {
        window.localStorage.setItem(key, JSON.stringify(prefs));
    } catch {
        /* private mode: keep the Home loop usable for this session */
    }
}

function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function pinHomeRivalChallenge(userId, challengeId, rivalId) {
    if (challengeId === null || challengeId === undefined || challengeId === "") return;
    const prefs = readHomeRivalPrefs(userId);
    const next = {...prefs, pinnedChallengeId: String(challengeId), dismissedOn: null};
    if (rivalId !== null && rivalId !== undefined && rivalId !== "") {
        next.pinnedRivalId = String(rivalId);
    } else {
        delete next.pinnedRivalId;
    }
    writeHomeRivalPrefs(userId, next);
}

export function unpinHomeRivalChallenge(userId) {
    const prefs = readHomeRivalPrefs(userId);
    delete prefs.pinnedChallengeId;
    delete prefs.pinnedRivalId;
    writeHomeRivalPrefs(userId, prefs);
}

/** Query params for Home's private pinned rival; other pages keep the shared summary cache. */
export function homeRivalQueryParams(userId) {
    const prefs = readHomeRivalPrefs(userId);
    if (!prefs.pinnedChallengeId || !prefs.pinnedRivalId) return {};
    return {
        home_rival_challenge: prefs.pinnedChallengeId,
        home_rival_user: prefs.pinnedRivalId,
    };
}

export function dismissHomeRivalCard(userId, now = new Date()) {
    const prefs = readHomeRivalPrefs(userId);
    writeHomeRivalPrefs(userId, {...prefs, dismissedOn: localDateKey(now)});
}

/** Select one running Home challenge, honoring a user's private pin and daily dismissal. */
export function homeRivalChallengeSelection(competitions, userId, now = new Date()) {
    const list = Array.isArray(competitions) ? competitions : Object.values(competitions || {});
    const running = list.filter(isChallengeRunning);
    if (running.length === 0) return null;

    const prefs = readHomeRivalPrefs(userId);
    if (prefs.dismissedOn === localDateKey(now)) return null;

    const pinned = running.find((challenge) => String(challenge.id) === String(prefs.pinnedChallengeId));
    const challenge = pinned || lastChallenge(running);
    return challenge ? {challenge, pinned: Boolean(pinned)} : null;
}

// @vitest-environment jsdom
import {beforeEach, describe, expect, it} from "vitest";
import {challengeDaysLeftLabel, challengeEndChip, challengeRivalCard, daysUntilChallengeEnd, dismissHomeRivalCard, homeRivalChallengeSelection, homeRivalQueryParams, lastChallenge, pinHomeRivalChallenge, rememberLastCompetition, unpinHomeRivalChallenge} from "./challenge";

const noon = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
};

describe("daysUntilChallengeEnd", () => {
    it("counts whole local days until the inclusive end date", () => {
        expect(daysUntilChallengeEnd("2026-09-20", noon("2026-09-11"))).toBe(9);
        expect(daysUntilChallengeEnd("2026-09-12", noon("2026-09-11"))).toBe(1);
        expect(daysUntilChallengeEnd("2026-09-11", noon("2026-09-11"))).toBe(0);
        expect(daysUntilChallengeEnd("2026-09-10", noon("2026-09-11"))).toBe(-1);
    });

    it("does not shift a YYYY-MM-DD into the previous local day", () => {
        expect(daysUntilChallengeEnd("2026-09-20", new Date(2026, 8, 20, 1, 0, 0))).toBe(0);
    });

    it("returns null without a date", () => {
        expect(daysUntilChallengeEnd(null)).toBeNull();
        expect(daysUntilChallengeEnd("")).toBeNull();
    });
});

describe("challengeDaysLeftLabel", () => {
    it("uses day wording", () => {
        expect(challengeDaysLeftLabel("2026-09-20", noon("2026-09-11"))).toBe("9 days left");
        expect(challengeDaysLeftLabel("2026-09-12", noon("2026-09-11"))).toBe("1 day left");
        expect(challengeDaysLeftLabel("2026-09-11", noon("2026-09-11"))).toBe("Last day");
        expect(challengeDaysLeftLabel("2026-09-01", noon("2026-09-11"))).toBe("Ended");
    });
});

describe("challengeEndChip", () => {
    it("uses the end date, Last day, or Ended", () => {
        expect(challengeEndChip("2026-09-20", "Sat, Sep 20", noon("2026-09-11")))
            .toEqual({kind: "live", text: "Ends Sat, Sep 20"});
        expect(challengeEndChip("2026-09-11", "Fri, Sep 11", noon("2026-09-11")))
            .toEqual({kind: "last", text: "Last day"});
        expect(challengeEndChip("2026-09-01", "Tue, Sep 1", noon("2026-09-11")))
            .toEqual({kind: "ended", text: "Ended"});
    });
});

describe("challengeRivalCard", () => {
    it("shows the closest rival in ranking positions", () => {
        const challenge = {
            id: 4,
            name: "Autumn Run",
            my_rank_summary: {
                started: true,
                my_rank: 3,
                rival: {id: 9, username: "lena"},
                rival_rank: 2,
                places_to_rival: 1,
                points_to_catch: 18.2,
            },
        };
        expect(challengeRivalCard(challenge)).toEqual({
            kind: "chasing",
            challengeId: 4,
            challengeName: "Autumn Run",
            rivalId: 9,
            rivalUsername: "lena",
            rivalIsPinned: false,
            rivalPlacesAhead: 1,
        });
    });

    it("keeps a pinned rival even after they fall behind the user", () => {
        expect(challengeRivalCard({
            id: 2,
            name: "Challenge",
            my_rank_summary: {
                started: true,
                my_rank: 2,
                rival: {id: 9, username: "pinned"},
                rival_rank: 4,
                places_to_rival: -2,
                points_to_catch: -14,
                rival_is_pinned: true,
            },
        })).toMatchObject({
            kind: "defending",
            rivalId: 9,
            rivalUsername: "pinned",
            rivalPlacesBehind: 2,
            rivalIsPinned: true,
        });
    });

    it("shows a tie with a pinned rival without calling either ahead", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {
                started: true,
                my_rank: 2,
                rival: {id: 9, username: "pinned"},
                rival_rank: 2,
                places_to_rival: 0,
                points_to_catch: 0,
                rival_is_pinned: true,
            },
        })).toMatchObject({kind: "tied", rivalId: 9, rivalIsPinned: true});
    });

    it("shows a leader state when there is no higher-scoring user", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: 1, rival: null, points_to_catch: null},
        })).toEqual({kind: "leading", challengeId: 2, challengeName: "Challenge"});
    });

    it("offers a first-workout state to a participant who has not scored yet", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: null, rival: null, points_to_catch: null},
        })).toEqual({kind: "first-workout", challengeId: 2, challengeName: "Challenge"});
    });

    it("offers a configured personal target to a participant who has not scored yet", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: null, rival: null},
        }, {
            user: {goal_active_days: 3},
            workoutSummary: {d7: {active_days: 2}},
        })).toMatchObject({
            kind: "personal-goal",
            goalLabel: "active days",
            goalRemaining: 1,
        });
    });

    it("does not suggest a session that does not match a configured challenge metric", () => {
        const model = challengeRivalCard({
            id: 2,
            goals: [{metric: "kcal", goal: "1800", max_per_day: "1000"}],
            my_rank_summary: {
                started: true, my_rank: 2,
                rival: {id: 8, username: "Rival"}, places_to_rival: 1,
            },
        }, {
            user: {goal_workout_minutes: 150},
            workoutSummary: {d7: {seconds: 7200}},
        });
        expect(model.kind).toBe("chasing");
        expect(model).not.toHaveProperty("suggestedWorkout");
    });

    it("uses a configured scoring metric for a user without a personal metric preference", () => {
        expect(challengeRivalCard({
            id: 2,
            goals: [{metric: "min", goal: "150", max_per_workout: "45", max_per_day: "60", max_per_week: "240"}],
            my_rank_summary: {
                started: true, my_rank: 2,
                rival: {id: 8, username: "Rival"}, places_to_rival: 1,
            },
        })).toMatchObject({kind: "chasing", suggestedWorkout: "a comfortable 30-minute session"});
    });

    it("does not show a card before the competition starts", () => {
         expect(challengeRivalCard({id: 2, my_rank_summary: {started: false}})).toBeNull();
    });

    it("uses the nearest unfinished personal goal when there is no suitable rival", () => {
        expect(challengeRivalCard({
            id: 2,
            name: "Challenge",
            my_rank_summary: {started: true, my_rank: 1, rival: null},
        }, {
            user: {goal_active_days: 3, goal_workout_minutes: 150, goal_distance: null},
            workoutSummary: {d7: {active_days: 2, seconds: 3600, distance: 0}},
        })).toEqual({
            kind: "personal-goal",
            challengeId: 2,
            challengeName: "Challenge",
            goalKey: "active-days",
            goalLabel: "active days",
            goalTarget: 3,
            goalCurrent: 2,
            goalRemaining: 1,
            goalCompleted: false,
            suggestedWorkout: "one comfortable activity on a day not yet counted",
        });
    });

    it("carries the user's weekly goal context into a chasing card", () => {
        expect(challengeRivalCard({
            id: 2,
            name: "Spring challenge",
            goals: [{metric: "min", goal: "150", max_per_workout: null, max_per_day: "20", max_per_week: "240"}],
            my_rank_summary: {
                started: true,
                my_rank: 3,
                rival: {id: 8, username: "Rival"},
                places_to_rival: 1,
                gap_changed: true,
            },
        }, {
            user: {goal_active_days: null, goal_workout_minutes: 150, goal_distance: null},
            workoutSummary: {d7: {active_days: 2, seconds: 7200, distance: 0}},
        })).toMatchObject({
            kind: "chasing",
            rivalUsername: "Rival",
            gapChanged: true,
            goalKey: "workout-minutes",
            goalTarget: 150,
            goalCurrent: 120,
            goalRemaining: 30,
            goalCompleted: false,
            suggestedWorkout: "a comfortable 20-minute session",
        });
    });

    it("falls back to a personal goal when leaderboard data is stale or malformed", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: 4, rival: {id: 5}, points_to_catch: 10},
        }, {
            user: {goal_active_days: null, goal_workout_minutes: 150, goal_distance: null},
            workoutSummary: {d7: {active_days: 3, seconds: 5400, distance: 0}},
        })).toEqual({
            kind: "personal-goal",
            challengeId: 2,
            challengeName: "Challenge",
            goalKey: "workout-minutes",
            goalLabel: "minutes",
            goalTarget: 150,
            goalCurrent: 90,
            goalRemaining: 60,
            goalCompleted: false,
            suggestedWorkout: "a comfortable 30-minute session",
        });
    });

    it("falls back instead of trusting contradictory stale rival gap values", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {
                started: true,
                my_rank: 2,
                rival: {id: 5, username: "Rival"},
                rival_rank: 1,
                places_to_rival: 1,
                points_to_catch: -9,
            },
        })).toEqual({kind: "no-rival", challengeId: 2, challengeName: "Challenge"});
    });

    it("does not trust invalid summary values, and celebrates an achieved target", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: 2, rival: null},
        }, {
            user: {goal_active_days: 3},
            workoutSummary: {d7: {active_days: -1}},
        })).toEqual({
            kind: "personal-goal",
            challengeId: 2,
            challengeName: "Challenge",
            goalKey: "active-days",
            goalLabel: "active days",
            goalTarget: 3,
            goalCurrent: null,
            goalRemaining: null,
            goalCompleted: false,
        });

        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: 1, rival: null},
        }, {
            user: {goal_active_days: 3},
            workoutSummary: {d7: {active_days: 3}},
        })).toMatchObject({
            kind: "personal-goal",
            goalCurrent: 3,
            goalTarget: 3,
            goalRemaining: 0,
            goalCompleted: true,
        });
    });

    it("uses a neutral no-rival state instead of hiding an unsafe leaderboard card", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: 2, rival: {id: 5}, points_to_catch: 10},
        })).toEqual({kind: "no-rival", challengeId: 2, challengeName: "Challenge"});
    });

    it("keeps the first-workout state and does not invent a personal goal", () => {
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: null, rival: null},
        })).toEqual({kind: "first-workout", challengeId: 2, challengeName: "Challenge"});
        expect(challengeRivalCard({
            id: 2,
            my_rank_summary: {started: true, my_rank: 2, rival: null},
        })).toEqual({kind: "no-rival", challengeId: 2, challengeName: "Challenge"});
    });

    it("does not use leaderboard positions as a personal-goal substitute before start", () => {
        expect(challengeRivalCard({id: 2, my_rank_summary: {started: false}}, {
            user: {goal_active_days: 3},
        })).toBeNull();
    });
});

describe("lastChallenge", () => {
    it("returns the remembered challenge when the user still belongs", () => {
        rememberLastCompetition("/competition/7");
        const list = [{id: 3, name: "A"}, {id: 7, name: "B"}];
        expect(lastChallenge(list).id).toBe(7);
    });

    it("falls back when the remembered id is gone", () => {
        rememberLastCompetition("/competition/99");
        const list = [{id: 3, name: "Only"}];
        expect(lastChallenge(list).id).toBe(3);
    });
});

describe("Home rival challenge selection", () => {
    const today = noon("2026-09-29");
    const active = [
        {id: 4, name: "Recent", start_date_epoch: 0, end_date_epoch: 4102444800},
        {id: 7, name: "Other", start_date_epoch: 0, end_date_epoch: 4102444800},
    ];

    const storage = new Map();
    const localStorageMock = {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    };

    beforeEach(() => {
        storage.clear();
        Object.defineProperty(window, "localStorage", {configurable: true, value: localStorageMock});
        rememberLastCompetition("/competition/4");
    });

    it("honors the last-opened running challenge until the user pins another", () => {
        expect(homeRivalChallengeSelection(active, 42, today)).toEqual({challenge: active[0], pinned: false});
        pinHomeRivalChallenge(42, 7, 9);
        expect(homeRivalChallengeSelection(active, 42, today)).toEqual({challenge: active[1], pinned: true});
        expect(homeRivalQueryParams(42)).toEqual({home_rival_challenge: "7", home_rival_user: "9"});
        expect(homeRivalChallengeSelection(active, 43, today)).toEqual({challenge: active[0], pinned: false});
        unpinHomeRivalChallenge(42);
        expect(homeRivalChallengeSelection(active, 42, today)).toEqual({challenge: active[0], pinned: false});
        expect(homeRivalQueryParams(42)).toEqual({});
    });

    it("dismisses the Home card only for the current local day", () => {
        dismissHomeRivalCard(42, today);
        expect(homeRivalChallengeSelection(active, 42, today)).toBeNull();
        expect(homeRivalChallengeSelection(active, 42, noon("2026-09-30"))).toEqual({challenge: active[0], pinned: false});
    });

    it("falls back to the last-opened challenge if a pinned challenge is no longer active", () => {
        pinHomeRivalChallenge(42, 99);
        expect(homeRivalChallengeSelection(active, 42, today)).toEqual({challenge: active[0], pinned: false});
    });

    it("keeps preferences usable for the session when browser storage is blocked", () => {
        Object.defineProperty(window, "localStorage", {configurable: true, get() { throw new Error("blocked"); }});
        pinHomeRivalChallenge(42, 7);
        expect(homeRivalChallengeSelection(active, 42, today)).toEqual({challenge: active[1], pinned: true});
    });
});
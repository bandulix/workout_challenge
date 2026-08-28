import {describe, expect, it} from "vitest";
import {
    isApkOutdated,
    matchingImageCacheKeys,
    pageResults,
    scoreGoals,
} from "./queryPage";

describe("isApkOutdated", () => {
    it("is true only when the server publishes a higher versionCode", () => {
        expect(isApkOutdated(12, 13)).toBe(true);
        expect(isApkOutdated("12", "13")).toBe(true);
        expect(isApkOutdated(13, 13)).toBe(false);
        expect(isApkOutdated(14, 13)).toBe(false);
        expect(isApkOutdated(12, 0)).toBe(false);
        expect(isApkOutdated(12, null)).toBe(false);
        expect(isApkOutdated(undefined, 5)).toBe(true);
    });
});

describe("pageResults", () => {
    it("unwraps arrays and {results} pages", () => {
        expect(pageResults(null)).toEqual([]);
        expect(pageResults([{id: 1}])).toEqual([{id: 1}]);
        expect(pageResults({results: [{id: 2}], count: 9})).toEqual([{id: 2}]);
        expect(pageResults({count: 0})).toEqual([]);
    });
});

describe("matchingImageCacheKeys", () => {
    it("drops the unsized path and every size= variant", () => {
        const keys = [
            "/api/user/1/picture/",
            "/api/user/1/picture/?size=card",
            "/api/user/1/picture/?size=full",
            "/api/user/1/picture/?size=avatar",
            "/api/user/2/picture/",
            "/api/user/10/picture/",
        ];
        expect(matchingImageCacheKeys(keys, "/api/user/1/picture/")).toEqual([
            "/api/user/1/picture/",
            "/api/user/1/picture/?size=card",
            "/api/user/1/picture/?size=full",
            "/api/user/1/picture/?size=avatar",
        ]);
        expect(matchingImageCacheKeys(keys, "/api/user/1/picture/?size=card")).toEqual([
            "/api/user/1/picture/",
            "/api/user/1/picture/?size=card",
            "/api/user/1/picture/?size=full",
            "/api/user/1/picture/?size=avatar",
        ]);
        expect(matchingImageCacheKeys(keys, "")).toEqual([]);
        expect(matchingImageCacheKeys(keys, null)).toEqual([]);
    });
});

describe("scoreGoals", () => {
    const goals = [
        {id: 7, name: "Move", metric: "kcal", goal: 1800, period: "week"},
        {id: 8, name: "Run", metric: "km", goal: 20, period: "week"},
    ];

    it("uses my_goal_points from a paged feed and scales the target", () => {
        const scored = scoreGoals(
            goals,
            {results: [], my_goal_points: {7: 40, "8": 10}},
            1,
            {scaling_kcal: 0.5, scaling_distance: 2},
        );
        expect(scored[0].points_capped).toBe(40);
        expect(scored[0].goal).toBe(900);
        expect(scored[1].points_capped).toBe(10);
        expect(scored[1].goal).toBe(40);
    });

    it("does not treat a page object as workout rows", () => {
        const scored = scoreGoals(
            goals,
            {count: 99, offset: 0, limit: 15, results: [], my_goal_points: {}},
            1,
            {},
        );
        expect(scored[0].points_capped).toBe(0);
        expect(scored[1].points_capped).toBe(0);
    });

    it("falls back to summing details on an unpaged array", () => {
        const feed = [{
            workout__user: 1,
            workout__start_datetime_fmt: {epoch: Math.floor(Date.now() / 1000)},
            details: [{goal: 7, points_capped: 12}, {goal: 8, points_capped: 3}],
        }];
        const scored = scoreGoals(goals, feed, 1, {});
        expect(scored[0].points_capped).toBe(12);
        expect(scored[1].points_capped).toBe(3);
    });
});

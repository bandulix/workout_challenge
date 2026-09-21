import {describe, expect, it} from "vitest";
import {heatmapWeeks, levelFor, weeklyMinutes} from "./TrainingHeatmap";

describe("levelFor", () => {
    it("maps minutes to intensity levels", () => {
        expect(levelFor(0)).toBe(0);
        expect(levelFor(10 * 60)).toBe(1);      // a short walk
        expect(levelFor(45 * 60)).toBe(2);      // a real session
        expect(levelFor(90 * 60)).toBe(3);      // a long one
    });
});

describe("heatmapWeeks", () => {
    const today = new Date(2026, 8, 21); // Monday, Sep 21 2026

    it("builds 26 Monday-anchored columns ending this week", () => {
        const weeks = heatmapWeeks({}, today);
        expect(weeks).toHaveLength(26);
        expect(weeks[25][0].iso).toBe("2026-09-21");       // this Monday
        expect(weeks[25][6].iso).toBe("2026-09-27");       // this Sunday
        expect(weeks[0][0].iso).toBe("2026-03-30");        // 25 weeks earlier
    });

    it("fills seconds from the days map and flags future days", () => {
        const weeks = heatmapWeeks({"2026-09-21": 1800}, today);
        expect(weeks[25][0].seconds).toBe(1800);
        expect(weeks[25][0].future).toBe(false);
        expect(weeks[25][1].future).toBe(true);            // tomorrow
        expect(weeks[25][1].seconds).toBe(0);
    });
});

describe("weeklyMinutes", () => {
    it("sums each column into minutes", () => {
        const weeks = heatmapWeeks({"2026-09-21": 1800, "2026-09-22": 1800}, new Date(2026, 8, 23));
        expect(weeklyMinutes(weeks)[25]).toBe(60);
    });
});

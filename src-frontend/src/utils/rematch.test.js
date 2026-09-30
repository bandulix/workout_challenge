import {describe, expect, it} from "vitest";
import {buildRematchSeed} from "./rematch";

describe("buildRematchSeed", () => {
    it("starts a fresh window tomorrow and preserves the challenge shape", () => {
        const seed = buildRematchSeed({
            name: "Autumn Challenge",
            start_date: "2026-10-01",
            end_date: "2026-10-30",
            has_teams: true,
            organizer_assigns_teams: false,
            expedition_enabled: true,
            expedition_objective: "rescue",
            expedition_theme: "ocean",
        }, new Date(2026, 9, 31, 12));

        expect(seed).toEqual({
            name: "Autumn Challenge · Rematch",
            start_date: "2026-11-01",
            end_date: "2026-11-30",
            has_teams: true,
            organizer_assigns_teams: false,
            // Same objective, but the route is left to rotate.
            expedition_enabled: true,
            expedition_objective: "rescue",
            expedition_theme: "",
        });
    });

    it("preserves a one-day inclusive challenge window", () => {
        const seed = buildRematchSeed({
            name: "Single Day",
            start_date: "2026-10-30",
            end_date: "2026-10-30",
        }, new Date(2026, 9, 31, 12));

        expect(seed.start_date).toBe("2026-11-01");
        expect(seed.end_date).toBe("2026-11-01");
    });

    it("uses a safe thirty-day default for missing or invalid old dates", () => {
        const seed = buildRematchSeed({name: "", start_date: "invalid", end_date: null}, new Date(2026, 9, 31, 12));

        expect(seed.name).toBe("Challenge · Rematch");
        expect(seed.start_date).toBe("2026-11-01");
        expect(seed.end_date).toBe("2026-11-30");
        expect(seed.has_teams).toBe(false);
        expect(seed.organizer_assigns_teams).toBe(false);
    });
});

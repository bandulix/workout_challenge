import {describe, expect, it} from "vitest";
import {challengeDaysLeftLabel, daysUntilChallengeEnd} from "./challenge";

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

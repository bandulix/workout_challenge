import {describe, expect, it} from "vitest";
import {challengeDaysLeftLabel, challengeEndChip, daysUntilChallengeEnd, lastChallenge, rememberLastCompetition} from "./challenge";

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

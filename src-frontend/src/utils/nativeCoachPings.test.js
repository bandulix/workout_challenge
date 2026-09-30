import {describe, expect, it} from "vitest";
import {isEligibleCoachKind} from "./nativeCoachPings";

describe("native coach notification eligibility", () => {
    it("does not notify participants about public inactivity or last-place penalties", () => {
        expect(isEligibleCoachKind("dunce")).toBe(false);
        expect(isEligibleCoachKind("sigh")).toBe(false);
    });

    it("keeps positive coach and Echo updates eligible", () => {
        expect(isEligibleCoachKind("echo")).toBe(true);
        expect(isEligibleCoachKind("claim")).toBe(true);
    });
});

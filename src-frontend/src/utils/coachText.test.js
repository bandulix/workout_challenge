import {describe, expect, it} from "vitest";
import {stripCharacterCountSuffix} from "./coachText";

describe("stripCharacterCountSuffix", () => {
    it.each([
        ["Great work (214 Zeichen)", "Great work"],
        ["Great work (214 Zeichen).", "Great work."],
        ["Great work (220 characters)", "Great work"],
        ["Great work (220 chars)", "Great work"],
        ["Great work (220 CHARACTERS)", "Great work"],
        ["Great work (220 characters) and then more", "Great work (220 characters) and then more"],
        ["214 km of jokes", "214 km of jokes"],
    ])("filters only a trailing count from %j", (value, expected) => {
        expect(stripCharacterCountSuffix(value)).toBe(expected);
    });
});

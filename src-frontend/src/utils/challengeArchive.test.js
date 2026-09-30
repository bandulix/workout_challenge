// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {archiveChallenge, getArchivedChallengeIds, isChallengeEnded, restoreChallenge} from "./challengeArchive";

let store;
beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
        clear: () => store.clear(),
    });
});
afterEach(() => vi.unstubAllGlobals());

describe("local challenge archive", () => {
    it("hides only explicitly archived ids and can restore them without deleting challenge data", () => {
        localStorage.setItem("unrelated-app-data", "preserved");
        archiveChallenge(42);
        archiveChallenge("42");

        expect(getArchivedChallengeIds()).toEqual(["42"]);
        expect(localStorage.getItem("unrelated-app-data")).toBe("preserved");

        restoreChallenge(42);
        expect(getArchivedChallengeIds()).toEqual([]);
        expect(localStorage.getItem("unrelated-app-data")).toBe("preserved");
    });

    it("only treats a valid challenge end date before today as completed", () => {
        const today = new Date(2026, 9, 31, 12);

        expect(isChallengeEnded("2026-10-30", today)).toBe(true);
        expect(isChallengeEnded("2026-10-31", today)).toBe(false);
        expect(isChallengeEnded("bad-date", today)).toBe(false);
    });
});

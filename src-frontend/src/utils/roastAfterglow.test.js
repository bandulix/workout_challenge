import {describe, expect, it} from "vitest";
import {hallAfterglowSfxItems, roastHottestId, roastIsAfterglow} from "./roastAfterglow";

describe("roastIsAfterglow", () => {
    it("is true only within an hour of the last hot", () => {
        const now = Date.parse("2026-09-11T12:00:00Z");
        expect(roastIsAfterglow({last_hot_at: "2026-09-11T11:30:00Z"}, now)).toBe(true);
        expect(roastIsAfterglow({last_hot_at: "2026-09-11T10:59:00Z"}, now)).toBe(false);
        expect(roastIsAfterglow({last_hot_at: null}, now)).toBe(false);
    });
});

describe("roastHottestId", () => {
    it("crowns a unique leader and sits out ties", () => {
        expect(roastHottestId([
            {id: 1, hot_votes: 3},
            {id: 2, hot_votes: 5},
            {id: 3, hot_votes: 1},
        ])).toBe(2);
        expect(roastHottestId([
            {id: 1, hot_votes: 4},
            {id: 2, hot_votes: 4},
        ])).toBeNull();
        expect(roastHottestId([{id: 1, hot_votes: 0}])).toBeNull();
    });
});

describe("hallAfterglowSfxItems", () => {
    it("keys the sting to the last-hot timestamp", () => {
        const now = Date.parse("2026-09-11T12:00:00Z");
        const items = hallAfterglowSfxItems([
            {id: 9, last_hot_at: "2026-09-11T11:50:00Z"},
            {id: 8, last_hot_at: "2026-09-11T10:00:00Z"},
        ], now);
        expect(items).toEqual([
            {key: "roast-hot:9:2026-09-11T11:50:00Z", sound: "roast_hot"},
        ]);
    });

    it("does not sting the voter in the seconds after they swipe Hot", () => {
        const now = Date.parse("2026-09-11T12:00:00Z");
        expect(hallAfterglowSfxItems([
            {id: 3, last_hot_at: "2026-09-11T11:59:58Z", my_vote: true},
        ], now)).toEqual([]);
    });
});

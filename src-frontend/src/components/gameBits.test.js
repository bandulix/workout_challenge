import {describe, expect, it} from "vitest";
import {hallShowcase} from "./gameBits";

function card(id, posted_at, react_count = 0) {
    return {id, posted_at, react_count};
}

describe("hallShowcase", () => {
    it("shows the 3 newest first, then the 3 most reacted", () => {
        const cards = [
            card("old-hot", "2026-09-01T10:00:00Z", 9),
            card("mid-hot", "2026-09-10T10:00:00Z", 7),
            card("new-1", "2026-09-20T10:00:00Z", 0),
            card("new-2", "2026-09-19T10:00:00Z", 1),
            card("new-3", "2026-09-18T10:00:00Z", 0),
            card("older", "2026-09-05T10:00:00Z", 2),
        ];
        const {newest, topReacted} = hallShowcase(cards);
        expect(newest.map((c) => c.id)).toEqual(["new-1", "new-2", "new-3"]);
        expect(topReacted.map((c) => c.id)).toEqual(["old-hot", "mid-hot", "older"]);
    });

    it("never shows a card twice - a new crowd favourite stays in the newest row only", () => {
        const cards = [
            card("new-banger", "2026-09-20T10:00:00Z", 12),
            card("new-2", "2026-09-19T10:00:00Z", 0),
            card("new-3", "2026-09-18T10:00:00Z", 0),
            card("old-hot", "2026-09-01T10:00:00Z", 5),
        ];
        const {newest, topReacted} = hallShowcase(cards);
        expect(newest.map((c) => c.id)).toContain("new-banger");
        expect(topReacted.map((c) => c.id)).toEqual(["old-hot"]);
    });

    it("breaks reaction ties by recency", () => {
        const cards = [
            card("new-1", "2026-09-20T10:00:00Z", 0),
            card("new-2", "2026-09-19T10:00:00Z", 0),
            card("new-3", "2026-09-18T10:00:00Z", 0),
            card("tie-old", "2026-09-01T10:00:00Z", 4),
            card("tie-new", "2026-09-10T10:00:00Z", 4),
        ];
        const {topReacted} = hallShowcase(cards);
        expect(topReacted.map((c) => c.id)).toEqual(["tie-new", "tie-old"]);
    });

    it("handles small and empty halls", () => {
        expect(hallShowcase([]).list).toEqual([]);
        const {newest, topReacted} = hallShowcase([card("only", "2026-09-20T10:00:00Z", 3)]);
        expect(newest).toHaveLength(1);
        expect(topReacted).toHaveLength(0);
    });
});

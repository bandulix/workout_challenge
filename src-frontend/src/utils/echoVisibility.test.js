import {describe, expect, it} from "vitest";
import {noteworthyEchoes} from "./echoVisibility";

const NOW = new Date("2026-09-29T00:00:00.000Z");

const echo = (overrides = {}) => ({
    id: 1,
    status: "undefeated",
    created_at: "2026-09-01T00:00:00.000Z",
    last_claimed_at: null,
    ...overrides,
});

describe("noteworthyEchoes", () => {
    it("hides quiet legacy Echoes from the live surface", () => {
        expect(noteworthyEchoes([echo()], NOW)).toEqual([]);
    });

    it("shows recently planted Echoes, even when they have since become immortal", () => {
        const planted = echo({
            status: "immortal",
            created_at: "2026-09-28T12:00:00.000Z",
        });
        expect(noteworthyEchoes([planted], NOW)).toEqual([planted]);
    });

    it("shows a relic marked as threatened until the threat resolves", () => {
        const threatened = echo({threatened: true});
        expect(noteworthyEchoes([threatened], NOW)).toEqual([threatened]);
    });

    it("shows recently taken Echoes, then returns them to the archive", () => {
        const taken = echo({last_claimed_at: "2026-09-27T00:00:00.000Z"});
        expect(noteworthyEchoes([taken], NOW)).toEqual([taken]);
        expect(noteworthyEchoes([
            echo({last_claimed_at: "2026-09-20T00:00:00.000Z"}),
        ], NOW)).toEqual([]);
    });

    it("ignores malformed and future timestamps", () => {
        expect(noteworthyEchoes([
            echo({created_at: "not-a-date"}),
            echo({id: 2, created_at: "2026-10-01T00:00:00.000Z"}),
        ], NOW)).toEqual([]);
    });
});

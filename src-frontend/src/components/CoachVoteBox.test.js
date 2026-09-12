import {describe, expect, it} from "vitest";
import {pinBallotCandidates, sortBallotCandidates} from "./CoachVoteBox";

function row({name, votes = 0, is_builtin = false, created_at, id}) {
    return {
        votes,
        persona: {id: id || name, name, is_builtin, created_at},
    };
}

describe("sortBallotCandidates", () => {
    it("puts the most votes first", () => {
        const sorted = sortBallotCandidates([
            row({name: "Low", votes: 1, created_at: "2026-09-01T00:00:00Z"}),
            row({name: "High", votes: 3, is_builtin: true, created_at: "2026-01-01T00:00:00Z"}),
        ]);
        expect(sorted.map((c) => c.persona.name)).toEqual(["High", "Low"]);
    });

    it("among equal votes, newest custom coaches beat stock", () => {
        const sorted = sortBallotCandidates([
            row({name: "Sergeant", is_builtin: true, created_at: "2026-01-01T00:00:00Z"}),
            row({name: "Old Voice", created_at: "2026-08-01T00:00:00Z"}),
            row({name: "New Voice", created_at: "2026-09-10T00:00:00Z"}),
            row({name: "Roast", is_builtin: true, created_at: "2026-01-02T00:00:00Z"}),
        ]);
        expect(sorted.map((c) => c.persona.name)).toEqual([
            "New Voice",
            "Old Voice",
            "Roast",
            "Sergeant",
        ]);
    });
});

describe("pinBallotCandidates", () => {
    it("pins on-duty and your vote ahead of the ranked rest", () => {
        const ranked = sortBallotCandidates([
            row({name: "Leader", votes: 4, id: "l"}),
            row({name: "Duty", votes: 0, is_builtin: true, id: "d"}),
            row({name: "Mine", votes: 1, id: "m"}),
        ]);
        const pinned = pinBallotCandidates(ranked, "m", "d");
        expect(pinned.map((c) => c.persona.name)).toEqual(["Duty", "Mine", "Leader"]);
    });
});

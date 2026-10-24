import {describe, expect, it} from "vitest";
import {rankPeople, windowTotal} from "./boardPeriod";

describe("windowTotal", () => {
    it("sums the requested number of day offsets", () => {
        const series = {4: {0: {total: 10}, 1: {total: 5}, 2: {total: "3"}}};
        const read = (rows, id, offset) => rows?.[id]?.[offset]?.total;
        expect(windowTotal(series, 4, 7, read)).toBe(18);
        expect(windowTotal(series, 9, 7, read)).toBe(0);
    });
});

describe("rankPeople", () => {
    it("shares a rank on a tie and sorts the rest after it", () => {
        const people = [
            {id: 1, username: "bea"},
            {id: 2, username: "ada"},
            {id: 3, username: "cy"},
        ];
        const ranked = rankPeople(people, (person) => ({1: 10, 2: 10, 3: 4}[person.id]));
        expect(ranked.map((row) => [row.person.username, row.rank, row.score])).toEqual([
            ["ada", 1, 10],
            ["bea", 1, 10],
            ["cy", 3, 4],
        ]);
    });
});

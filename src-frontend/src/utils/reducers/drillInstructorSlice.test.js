import {describe, expect, it} from "vitest";
import {drillMessagesMerge} from "./drillInstructorSlice";

const rows = (ids) => ({results: ids.map((id) => ({id})), count: 100, limit: ids.length});

describe("drillMessagesMerge", () => {
    it("page 0 replaces the head and keeps older loaded pages", () => {
        const current = {...rows([1, 2, 3, 4]), limit: 2};
        const incoming = {...rows([9, 8]), limit: 2};  // fresh page 0
        const merged = drillMessagesMerge(current, incoming, {arg: {offset: 0}});
        expect(merged.results.map((m) => m.id)).toEqual([9, 8, 3, 4]);
    });

    it("page 0 dedupes rows that re-arrive in the fresh head", () => {
        const current = {...rows([1, 2, 3]), limit: 2};
        const incoming = {...rows([2, 1]), limit: 2};
        const merged = drillMessagesMerge(current, incoming, {arg: {offset: 0}});
        expect(merged.results.map((m) => m.id)).toEqual([2, 1, 3]);
    });

    it("later pages append deduped and keep the server count", () => {
        const current = {...rows([1, 2]), count: 5, limit: 2};
        const incoming = {results: [{id: 2}, {id: 3}], count: 5, limit: 2};
        const merged = drillMessagesMerge(current, incoming, {arg: {offset: 2}});
        expect(merged.results.map((m) => m.id)).toEqual([1, 2, 3]);
        expect(merged.count).toBe(5);
    });

    it("append on an empty cache is just the page", () => {
        const merged = drillMessagesMerge(undefined, rows([7]), {arg: {offset: 15}});
        expect(merged.results.map((m) => m.id)).toEqual([7]);
    });
});

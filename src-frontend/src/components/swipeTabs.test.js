import {describe, expect, it} from "vitest";
import {peekableTabIds} from "./swipeTabs";

describe("peekableTabIds", () => {
    it("is only the current tab until a drag starts", () => {
        expect(peekableTabIds(0, false, new Set([0]))).toEqual(["feed"]);
    });

    it("includes Board while dragging off Feed so stats can load before ?tab= changes", () => {
        expect(peekableTabIds(0, true, new Set([0]))).toEqual(["feed", "board"]);
    });

    it("keeps tabs that have already been opened", () => {
        expect(peekableTabIds(0, false, new Set([0, 1]))).toEqual(["feed", "board"]);
    });
});

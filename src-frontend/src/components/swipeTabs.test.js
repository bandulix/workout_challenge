import {describe, expect, it} from "vitest";
import {challengeTabs, peekableTabIds} from "./swipeTabs";

describe("challengeTabs", () => {
    it("adds the Trail page between Feed and Leaderboard only when the challenge runs an Expedition", () => {
        expect(challengeTabs(false).map((t) => t.id)).toEqual(["feed", "board"]);
        expect(challengeTabs(true).map((t) => t.id)).toEqual(["feed", "trail", "board"]);
    });

    it("peeks the neighbouring page from the custom tab set while dragging", () => {
        expect(peekableTabIds(1, true, new Set([1]), challengeTabs(true))).toEqual(["feed", "trail", "board"]);
        expect(peekableTabIds(0, true, new Set([0]), challengeTabs(true))).toEqual(["feed", "trail"]);
    });
});

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

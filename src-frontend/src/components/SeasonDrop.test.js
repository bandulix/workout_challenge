// @vitest-environment jsdom
import React from "react";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import SeasonDrop, {SEASON_ID, markSeasonSeen} from "./SeasonDrop";

const storage = new Map();
const localStorageMock = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};

afterEach(cleanup);

beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, "localStorage", {configurable: true, value: localStorageMock});
});

describe("SeasonDrop", () => {
    it("shows the poster once, then stays gone", () => {
        const first = render(<SeasonDrop/>);
        expect(screen.getByRole("dialog", {name: /new season/i})).toBeTruthy();
        expect(screen.getByText(/the trail/i)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", {name: /step on/i}));
        expect(window.localStorage.getItem("wc-season-seen")).toBe(SEASON_ID);
        expect(screen.queryByRole("dialog")).toBeNull();
        first.unmount();

        render(<SeasonDrop/>);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("stays quiet when this season was already seen", () => {
        markSeasonSeen();
        render(<SeasonDrop/>);
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

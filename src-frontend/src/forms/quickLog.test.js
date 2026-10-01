// @vitest-environment jsdom
import React from "react";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const addWorkoutMock = vi.fn();
const dispatchMock = vi.fn();

vi.mock("../utils/reducers/workoutsSlice", () => ({
    useAddWorkoutMutation: () => [addWorkoutMock, {isLoading: false}],
}));
vi.mock("../utils/reducers/statsSlice", () => ({statsApi: {util: {invalidateTags: vi.fn(() => ({type: "stats"}))}}}));
vi.mock("../utils/reducers/feedSlice", () => ({feedApi: {util: {invalidateTags: vi.fn(() => ({type: "feed"}))}}}));
vi.mock("../utils/reducers/competitionsSlice", () => ({competitionsApi: {util: {invalidateTags: vi.fn(() => ({type: "comp"}))}}}));
vi.mock("react-redux", () => ({useDispatch: () => dispatchMock}));
vi.mock("./basicComponents", () => ({
    Modal: ({title, children}) => <div><h2>{title}</h2>{children}</div>,
}));
vi.mock("../utils/toasts", () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import QuickLogSheet, {minutesToDuration, readRecentSports, rememberSport} from "./quickLog";

const store = new Map();
beforeEach(() => {
    store.clear();
    addWorkoutMock.mockReset();
    dispatchMock.mockReset();
    Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
            clear: () => store.clear(),
        },
    });
});
afterEach(cleanup);

describe("minutesToDuration", () => {
    it("formats minutes as HH:MM:SS", () => {
        expect(minutesToDuration(30)).toBe("00:30:00");
        expect(minutesToDuration(90)).toBe("01:30:00");
        expect(minutesToDuration(0)).toBe("00:01:00");
    });
});

describe("recent sports", () => {
    it("puts the last logged sport first and never stores Steps", () => {
        rememberSport("Yoga");
        rememberSport("Steps");
        expect(readRecentSports()[0]).toBe("Yoga");
        expect(readRecentSports()).not.toContain("Steps");
        expect(readRecentSports()).toHaveLength(8);
    });
});

describe("QuickLogSheet", () => {
    it("saves with two taps using the defaults for everything else", async () => {
        addWorkoutMock.mockReturnValue({unwrap: () => Promise.resolve({id: 1})});
        const setModalState = vi.fn();
        const logged = vi.fn();
        window.addEventListener("wc:logged", logged);

        render(<QuickLogSheet setModalState={setModalState}/>);
        fireEvent.click(screen.getByRole("button", {name: "Biking/Cycling"}));
        fireEvent.click(screen.getByRole("button", {name: "45"}));
        fireEvent.click(screen.getByRole("button", {name: /^Save Cycling · 45 min$/}));

        await waitFor(() => expect(setModalState).toHaveBeenCalledWith(false));
        const body = addWorkoutMock.mock.calls[0][0];
        expect(body.sport_type).toBe("Ride");
        expect(body.duration).toBe("00:45:00");
        expect(body.intensity_category).toBe(2);
        expect(body.kcal).toBeNull();
        expect(logged).toHaveBeenCalledTimes(1);
        expect(logged.mock.calls[0][0].detail).toMatchObject({sport: "Ride", minutes: 45});
        expect(readRecentSports()[0]).toBe("Ride");
        window.removeEventListener("wc:logged", logged);
    });

    it("keeps the sheet open and shows the server's message when the save fails", async () => {
        addWorkoutMock.mockReturnValue({unwrap: () => Promise.reject({status: 400, data: {duration: ["Too long."]}})});
        const setModalState = vi.fn();
        render(<QuickLogSheet setModalState={setModalState}/>);
        fireEvent.click(screen.getByRole("button", {name: /^Save /}));
        expect(await screen.findByRole("alert")).toHaveTextContent("Too long.");
        expect(setModalState).not.toHaveBeenCalled();
    });

    it("hides duration and intensity for Steps and asks for a count instead", () => {
        render(<QuickLogSheet setModalState={vi.fn()}/>);
        fireEvent.click(screen.getByRole("button", {name: /all sports/i}));
        fireEvent.change(screen.getByLabelText("Search sports"), {target: {value: "steps"}});
        fireEvent.click(screen.getByRole("button", {name: /^Total Daily Steps$/}));
        expect(screen.getByLabelText("Total daily steps")).toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "45"})).toBeNull();
    });
});

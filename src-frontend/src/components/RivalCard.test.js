// @vitest-environment jsdom
import React from "react";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {MemoryRouter, Route, Routes} from "react-router-dom";
import RivalCard from "./RivalCard";

afterEach(cleanup);

const model = {
    kind: "chasing",
    challengeId: 4,
    challengeName: "Autumn Run",
    rivalId: 12,
    rivalUsername: "close-rival",
    rivalIsPinned: false,
    rivalPlacesAhead: 1,
};

describe("RivalCard", () => {
    it("opens the challenge when the card is clicked, without a manual-log button", () => {
        render(
            <MemoryRouter initialEntries={["/"]}>
                <Routes>
                    <Route path="/" element={<RivalCard model={model}/>}/>
                    <Route path="/competition/:id" element={<p>Challenge details</p>}/>
                </Routes>
            </MemoryRouter>,
        );

        const cardLink = screen.getByRole("link", {name: /open autumn run: close the gap to @close-rival/i});
        expect(cardLink.getAttribute("href")).toBe("/competition/4");
        expect(screen.queryByRole("button", {name: /log a workout/i})).toBeNull();

        fireEvent.click(cardLink);
        expect(screen.getByText("Challenge details")).toBeTruthy();
    });

    it("uses the configured personal goal while respecting challenge scoring caps", () => {
        render(
            <MemoryRouter>
                <RivalCard model={{
                    ...model,
                    goalKey: "workout-minutes",
                    goalLabel: "minutes",
                    goalTarget: 150,
                    goalCurrent: 120,
                    goalRemaining: 30,
                    goalCompleted: false,
                    suggestedWorkout: "a comfortable 30-minute session",
                }}/>
            </MemoryRouter>,
        );

        expect(screen.getByText(/30 minutes left toward your weekly goal/i)).toBeTruthy();
        expect(screen.getByText(/if it fits your plan, a comfortable 30-minute session could contribute toward your weekly minutes goal/i)).toBeTruthy();
        expect(screen.getByText(/challenge credit follows configured goals and remaining caps; no session guarantees a rank change/i)).toBeTruthy();
        expect(screen.queryByText(/guaranteed pass/i)).toBeNull();
    });

    it("explains the gap without a log button and without promising a pass", () => {
        render(
            <MemoryRouter>
                <RivalCard model={model}/>
            </MemoryRouter>,
        );

        expect(screen.getByText(/1 place ahead.*could narrow the gap if it fits a scoring goal/i)).toBeTruthy();
        expect(screen.getByText(/no session guarantees a rank change/i)).toBeTruthy();
        expect(screen.queryByRole("button", {name: /log an activity/i})).toBeNull();
    });

    it("lets the user pin the named rival or dismiss the Home prompt", () => {
        const onPin = vi.fn();
        const onDismiss = vi.fn();
        render(
            <MemoryRouter>
                <RivalCard model={model} onPin={onPin} onDismiss={onDismiss}/>
            </MemoryRouter>,
        );

        fireEvent.click(screen.getByRole("button", {name: "Pin @close-rival"}));
        fireEvent.click(screen.getByRole("button", {name: /dismiss until tomorrow/i}));
        expect(onPin).toHaveBeenCalledOnce();
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("keeps a pinned rival visible when the user has moved ahead", () => {
        render(
            <MemoryRouter>
                <RivalCard
                    model={{...model, kind: "defending", rivalIsPinned: true, rivalPlacesBehind: 2}}
                    isPinned
                    onPin={() => {}}
                />
            </MemoryRouter>,
        );

        expect(screen.getByText("Hold your lead over @close-rival")).toBeTruthy();
        expect(screen.getByText(/2 places behind @close-rival/i)).toBeTruthy();
        expect(screen.getByRole("button", {name: "Unpin @close-rival"})).toBeTruthy();
    });

    it("does not render rival controls when the summary has no valid rival", () => {
        render(
            <MemoryRouter>
                <RivalCard model={{kind: "no-rival", challengeId: 4, challengeName: "Autumn Run"}} onPin={() => {}}/>
            </MemoryRouter>,
        );

        expect(screen.queryByRole("button", {name: /pin @/i})).toBeNull();
    });

    it("shows the user's configured target when there is no rival to chase", () => {
        render(
            <MemoryRouter>
                <RivalCard model={{
                    kind: "personal-goal",
                    challengeId: 4,
                    challengeName: "Autumn Run",
                    goalKey: "active-days",
                    goalLabel: "active days",
                    goalTarget: 3,
                    goalCurrent: 2,
                    goalRemaining: 1,
                    goalCompleted: false,
                }}/>
            </MemoryRouter>,
        );

        expect(screen.getByText("Your personal target")).toBeTruthy();
        expect(screen.getByText("2 active days of 3 active days over the past 7 days; 1 active day to meet your target.")).toBeTruthy();
        expect(screen.queryByText(/points/i)).toBeNull();
    });

    it("keeps a useful challenge prompt when neither a rival nor personal goal is available", () => {
        render(
            <MemoryRouter>
                <RivalCard model={{kind: "no-rival", challengeId: 4, challengeName: "Autumn Run"}}/>
            </MemoryRouter>,
        );

        expect(screen.getByText("Keep building your challenge")).toBeTruthy();
        expect(screen.getByText("There’s no clear rival to chase right now. Your next activity still adds to the board.")).toBeTruthy();
    });

    it("signals when the challenge gap materially changes", () => {
        render(
            <MemoryRouter>
                <RivalCard model={{...model, gapChanged: true}}/>
            </MemoryRouter>,
        );

        expect(screen.getByText(/standings against your rival just changed/i)).toBeTruthy();
    });
});

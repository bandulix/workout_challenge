// @vitest-environment jsdom
import React from "react";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import DuelView from "./DuelView";

vi.mock("./ProfileAvatar", () => ({default: () => <span data-testid="avatar"/>}));
vi.mock("../utils/platform", () => ({isNativeApp: () => false}));
vi.mock("../utils/shareCard", () => ({sharePostCard: vi.fn()}));

afterEach(cleanup);

const live = {
    id: 4,
    competition_name: "Autumn Run",
    status: "active",
    duration_days: 7,
    metric_label: "Challenge points",
    you: {id: 1, username: "ada", score: 20},
    them: {id: 2, username: "bo", score: 8},
    gap: 12,
    leader: "you",
    seconds_remaining: 90000,
    in_grace: false,
    grace_seconds_remaining: 0,
    daily: [{date: "2026-10-20", you: 10, them: 4}, {date: "2026-10-21", you: 10, them: 4}],
    commentary: [{kind: "lead", body: "@ada nosed ahead. Keep it playful.", at: "2026-10-21T08:00:00Z"}],
    coach: {name: "Sarge"},
    forfeit: "Loser buys the beers",
};

describe("DuelView", () => {
    it("shows both athletes, the gap, and coach commentary", () => {
        render(<DuelView duel={live}/>);
        expect(screen.getByText("ada")).toBeTruthy();
        expect(screen.getByText("bo")).toBeTruthy();
        expect(screen.getByText("20")).toBeTruthy();
        expect(screen.getByText("8")).toBeTruthy();
        expect(screen.getByText(/You · 12 ahead/)).toBeTruthy();
        expect(screen.getByText(/@ada nosed ahead/)).toBeTruthy();
        expect(screen.getByText(/Only the two of you see this/)).toBeTruthy();
    });

    it("lets the person who owes it mark the forfeit, and shares the postcard", async () => {
        const onMark = vi.fn();
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "share", {configurable: true, value: share});
        render(<DuelView duel={{
            ...live,
            status: "completed",
            result: "challenger",
            forfeit_line: "Bo owes: the beers",
            can_mark_paid: true,
            can_rematch: true,
            leader: "you",
        }} onMarkPaid={onMark} onRematch={vi.fn()}/>);

        expect(screen.getAllByText("Bo owes: the beers").length).toBeGreaterThan(0);
        expect(screen.queryByText(/lost/i)).toBeNull();
        fireEvent.click(screen.getByRole("button", {name: "Mark forfeit paid"}));
        expect(onMark).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole("button", {name: "Share postcard"}));
        await waitFor(() => expect(share).toHaveBeenCalled());
        expect(share.mock.calls[0][0].text).toContain("Bo owes: the beers");
        expect(share.mock.calls[0][0].text).not.toMatch(/lost/i);
    });

    it("offers accept, decline, and counter while the invite is waiting", () => {
        const onAccept = vi.fn();
        const onDecline = vi.fn();
        const onCounter = vi.fn();
        render(<DuelView duel={{
            ...live,
            status: "pending",
            awaiting_you: true,
            respond_by: new Date(Date.now() + 3600 * 1000).toISOString(),
            starts_at: null,
            leader: "tied",
            gap: 0,
        }} onAccept={onAccept} onDecline={onDecline} onCounter={onCounter}/>);

        fireEvent.click(screen.getByRole("button", {name: "Accept"}));
        expect(onAccept).toHaveBeenCalledWith({forfeit_public: false, feed_opt_in: false});
        fireEvent.click(screen.getByRole("button", {name: "Decline"}));
        expect(onDecline).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole("button", {name: "Counter"}));
        fireEvent.click(screen.getByRole("button", {name: "Send the counter"}));
        expect(onCounter).toHaveBeenCalledWith(expect.objectContaining({duration_days: 7, forfeit: "Loser buys the beers"}));
    });
});

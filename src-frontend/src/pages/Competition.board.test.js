// @vitest-environment jsdom
import React from "react";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {IndividualLeaderboardBox} from "./Competition";

vi.mock("../utils/reducers/duelsSlice", () => ({
    useGetMyDuelsQuery: () => ({data: {blocked_user_ids: []}}),
    useBlockDuelMutation: () => [vi.fn(), {}],
    useUnblockDuelMutation: () => [vi.fn(), {}],
}));

vi.mock("../components/ProfileAvatar", () => ({
    default: ({user}) => <span data-testid="avatar">{user?.username || "avatar"}</span>,
}));

vi.mock("../components/AthleteCard", () => ({default: () => null}));
vi.mock("../components/DuelSheet", () => ({default: () => null}));

beforeEach(() => {
    class IO {
        observe() {}
        disconnect() {}
    }
    window.IntersectionObserver = IO;
});

afterEach(cleanup);

function athlete(id, username, score, rank) {
    return {
        id,
        username,
        workout__user__id: id,
        total_capped: score,
        rank,
        days_on_rank: 2,
    };
}

function statsFor(people) {
    return {
        competition: {
            id: 1,
            start_date: "2026-10-20",
            end_date: "2026-12-31",
            active_member_count: Math.max(1, people.length),
        },
        leaderboard: {individual: people},
        timeseries: {all: {}, user: {}},
    };
}

function renderBoard(people, userId) {
    return render(
        <IndividualLeaderboardBox stats={statsFor(people)} userId={userId} feed={[]}/>,
    );
}

describe("IndividualLeaderboardBox", () => {
    it("renders an empty field without throwing", () => {
        renderBoard([], 1);
        expect(screen.getByText("Waiting for the field")).toBeTruthy();
        expect(screen.queryByText(/That didn't work/)).toBeNull();
    });

    it("renders a single athlete, including when that athlete is you", () => {
        renderBoard([athlete(1, "Charlotte D.", 120, 1)], 1);
        expect(screen.getAllByRole("button", {name: /You, rank 1, 120 points/}).length).toBeGreaterThan(0);
        expect(screen.queryByText("last place")).toBeNull();
    });

    it("renders two athletes and a catch-up line", () => {
        renderBoard([
            athlete(2, "Tom S.B.", 200, 1),
            athlete(1, "Charlotte D.", 80, 2),
        ], 1);
        expect(screen.getAllByRole("button", {name: /You, rank 2, 80 points/}).length).toBeGreaterThan(0);
        expect(screen.getByText(/points to Tom S.B./)).toBeTruthy();
    });

    it("renders a top-three podium for three athletes", () => {
        renderBoard([
            athlete(2, "Tom S.B.", 300, 1),
            athlete(1, "Charlotte D.", 200, 2),
            athlete(3, "Ursula V.", 100, 3),
        ], 1);
        expect(screen.getByRole("list", {name: "Top three"})).toBeTruthy();
        expect(screen.getAllByRole("button", {name: /You, rank 2, 200 points/}).length).toBeGreaterThan(0);
    });

    it("shares a rank when athletes are tied", () => {
        renderBoard([
            athlete(2, "Tom S.B.", 150, 1),
            athlete(3, "Ursula V.", 150, 1),
            athlete(1, "Charlotte D.", 40, 3),
        ], 1);
        const ranks = screen.getAllByText("#1");
        expect(ranks.length).toBeGreaterThanOrEqual(2);
        expect(screen.getAllByRole("button", {name: /You, rank 3, 40 points/}).length).toBeGreaterThan(0);
    });

    it.each([
        ["top", 1, 1],
        ["middle", 6, 6],
        ["bottom", 11, 11],
    ])("places you at the %s of a 11-athlete board", (_where, userId, rank) => {
        const people = Array.from({length: 11}, (_, index) => {
            const id = index + 1;
            return athlete(id, id === 1 ? "Charlotte D." : `Athlete ${id}`, 1100 - index * 10, id);
        });
        renderBoard(people, userId);
        expect(screen.getAllByRole("button", {name: new RegExp(`You, rank ${rank},`)}).length).toBeGreaterThan(0);
        expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(11);
    });
});

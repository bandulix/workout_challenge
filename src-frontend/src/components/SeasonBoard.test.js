// @vitest-environment jsdom
import React from "react";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {useGetExpeditionByCompetitionQuery} from "../utils/reducers/competitionsSlice";
import SeasonBoard, {pickSeasonChallenge} from "./SeasonBoard";

vi.mock("../utils/reducers/competitionsSlice", () => ({
    useGetExpeditionByCompetitionQuery: vi.fn(),
}));
vi.mock("./ExpeditionPanel", () => ({
    ExpeditionRouteMap: () => <div data-testid="season-map"/>,
    seasonStageClass: () => "season-stage season-stage-ocean",
}));
vi.mock("./ProfileAvatar", () => ({
    default: () => <span data-testid="avatar"/>,
}));
vi.mock("./SeasonDrop", () => ({
    default: () => null,
}));

afterEach(cleanup);

const expedition = {
    enabled: true,
    milestones: [],
    route_title: "Ocean crossing",
    progress_percent: 43.2,
    participant_count: 3,
};

describe("pickSeasonChallenge", () => {
    it("ignores challenges that are not an expedition", () => {
        expect(pickSeasonChallenge([
            {id: 1, expedition_enabled: false},
            {id: 2, expedition_enabled: true},
        ], {id: 1, expedition_enabled: false})?.id).toBe(2);
    });

    it("keeps the rival card's challenge when that one is on a trail", () => {
        expect(pickSeasonChallenge([
            {id: 2, expedition_enabled: true},
            {id: 9, expedition_enabled: true},
        ], {id: 9, expedition_enabled: true})?.id).toBe(9);
    });
});

describe("SeasonBoard", () => {
    it("leads with the route, the name and one number, and opens the trail", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({data: expedition, isLoading: false});
        const onOpen = vi.fn();
        render(<SeasonBoard competitionId={4} user={{first_name: "Morgan"}} onOpen={onOpen}/>);

        expect(screen.getByText("Ocean crossing")).toBeTruthy();
        expect(screen.getByRole("heading", {name: "Morgan"})).toBeTruthy();
        expect(screen.getByText("43.2%")).toBeTruthy();
        expect(screen.getByText("3 on the trail")).toBeTruthy();
        expect(screen.getByTestId("season-map")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", {name: /open the trail/i}));
        expect(onOpen).toHaveBeenCalledOnce();
    });

    it("renders nothing when the challenge has no expedition", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({data: {enabled: false}, isLoading: false});
        const {container} = render(<SeasonBoard competitionId={4} user={{first_name: "Morgan"}} onOpen={vi.fn()}/>);
        expect(container.innerHTML).toBe("");
    });
});

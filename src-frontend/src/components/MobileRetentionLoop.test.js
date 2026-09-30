// @vitest-environment jsdom
import React from "react";
import {render, screen, within} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {MemoryRouter} from "react-router-dom";
import RivalCard from "./RivalCard";
import {ExpeditionTimeline} from "./ExpeditionPanel";

const expeditionFixture = {
    title: "Autumn Challenge",
    enabled: true,
    start_date: "2026-10-01",
    end_date: "2026-10-30",
    participant_count: 4,
    progress_percent: 42.5,
    personal_progress_percent: 15,
    current_coach: {name: "Juniper", theme_color: "#426b55"},
    milestones: [
        {
            milestone_id: "trailhead",
            sequence: 0,
            opens_on: "2026-10-01",
            target_on: "2026-10-01",
            status: "completed",
            coach_snapshot: {name: "Mira", avatar_asset_key: "captain"},
        },
        {
            milestone_id: "river-crossing",
            sequence: 1,
            opens_on: "2026-10-01",
            target_on: "2026-10-11",
            status: "in-progress",
        },
        {
            milestone_id: "finale",
            sequence: 3,
            opens_on: "2026-10-20",
            target_on: "2026-10-30",
            status: "ready",
        },
    ],
};

describe("mobile retention loop prototype", () => {
    it("keeps the Home next step named, truthful, and keyboard-addressable at 375px", () => {
        Object.defineProperty(window, "innerWidth", {configurable: true, value: 375});
        render(
            <MemoryRouter>
                <RivalCard model={{
                    kind: "chasing",
                    challengeId: 8,
                    challengeName: "Autumn Challenge",
                    rivalUsername: "close-rival",
                    rivalPlacesAhead: 1,
                }}/>
            </MemoryRouter>,
        );

        const challengeLink = screen.getByRole("link", {name: /open autumn challenge: close the gap/i});
        expect(window.innerWidth).toBe(375);
        expect(challengeLink.getAttribute("href")).toBe("/competition/8");
        expect(within(challengeLink).getByText(/1 place ahead.*could narrow the gap/i)).toBeInTheDocument();
        expect(challengeLink.querySelector(".min-w-0")).toBeTruthy();
        expect(challengeLink.querySelector(".shrink-0")).toBeTruthy();
    });

    it("keeps route progress and a readable milestone list available at 375px", () => {
        Object.defineProperty(window, "innerWidth", {configurable: true, value: 375});
        render(<ExpeditionTimeline expedition={expeditionFixture}/>);

        expect(window.innerWidth).toBe(375);
        expect(screen.getByRole("progressbar", {name: "Shared Expedition progress"})).toBeTruthy();
        const milestones = screen.getByRole("list", {name: "Expedition milestones"});
        expect(within(milestones).getByText("Trailhead")).toBeTruthy();
        expect(within(milestones).getByText("River crossing")).toBeTruthy();
        expect(within(milestones).getByText("Summit")).toBeTruthy();
        expect(within(milestones).getByRole("img", {name: "Completed with Mira"})).toBeTruthy();
        expect(within(milestones).queryByText("Mira")).toBeNull();
        expect(milestones.querySelector("li.min-w-0")).toBeTruthy();
    });
});

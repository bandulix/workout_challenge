// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useGetExpeditionByCompetitionQuery} from "../utils/reducers/competitionsSlice";
import {useProtectedImage} from "../utils/protectedMedia";
import ExpeditionPanel, {ExpeditionTeaser} from "./ExpeditionPanel";

vi.mock("../utils/reducers/competitionsSlice", () => ({
    useGetExpeditionByCompetitionQuery: vi.fn(),
    useVoteExpeditionShortcutMutation: () => [vi.fn(), {isLoading: false}],
}));
// Crew pictures are JWT-protected: the panel must never hand the raw
// /api/ URL to <img>/<image>, only the blob the authenticated loader returns.
vi.mock("../utils/protectedMedia", () => ({
    useProtectedImage: vi.fn(),
}));

const expedition = {
    competition_id: 8,
    title: "Autumn Challenge",
    enabled: true,
    route_template: "trail-v1",
    start_date: "2026-10-01",
    end_date: "2026-10-30",
    locked: true,
    participant_count: 4,
    progress_percent: 42.5,
    personal_progress_percent: 65,
    current_coach: {
        name: "Juniper",
        avatar: "🧭",
        theme_color: "#426b55",
        source: "competition",
    },
    milestones: [
        {
            stage_id: "departure",
            milestone_id: "trailhead",
            sequence: 0,
            opens_on: "2026-10-01",
            target_on: "2026-10-01",
            progress_fraction: 0,
            status: "completed",
            completed_at: "2026-10-01T12:00:00Z",
            coach_snapshot: {name: "Mira", avatar_asset_key: "captain"},
        },
        {
            stage_id: "crossing",
            milestone_id: "river-crossing",
            sequence: 1,
            opens_on: "2026-10-01",
            target_on: "2026-10-11",
            progress_fraction: 0.25,
            status: "in-progress",
            completed_at: null,
            coach_snapshot: {},
        },
        {
            stage_id: "ascent",
            milestone_id: "high-pass",
            sequence: 2,
            opens_on: "2026-10-11",
            target_on: "2026-10-20",
            progress_fraction: 0.6,
            status: "upcoming",
            completed_at: null,
            coach_snapshot: {},
        },
        {
            stage_id: "arrival",
            milestone_id: "finale",
            sequence: 3,
            opens_on: "2026-10-20",
            target_on: "2026-10-30",
            progress_fraction: 1,
            status: "ready",
            completed_at: null,
            coach_snapshot: {},
        },
    ],
};

describe("ExpeditionPanel", () => {
    afterEach(cleanup);

    beforeEach(() => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({data: expedition});
        useProtectedImage.mockImplementation((url) => (url ? {src: `blob:${url}`, failed: false} : {src: null, failed: false}));
    });

    it("shows accessible shared progress and a date-anchored milestone timeline", () => {
        render(<ExpeditionPanel competitionId={8}/>);

        expect(screen.getByRole("heading", {name: "Expedition"})).toBeTruthy();
        expect(screen.getByRole("progressbar", {name: "Shared Expedition progress"}).getAttribute("aria-valuenow")).toBe("42.5");
        expect(screen.queryByText(/Guided by/)).toBeNull(); // no coach chip, no date range: the map carries it
        expect(screen.getByText("4 on the trail")).toBeTruthy();
        const timeline = screen.getByRole("list", {name: "Expedition milestones"});
        // The coach who saw the crew through is the tick mark itself — no extra caption line.
        const stamp = within(timeline).getByRole("img", {name: "Completed with Mira"});
        expect(stamp.getAttribute("src")).toBe("/personas/captain.svg");
        expect(within(timeline).queryByText("Mira")).toBeNull();
        expect(within(timeline).getByText("River crossing")).toBeTruthy();
        expect(within(timeline).getByText("High pass")).toBeTruthy();
        expect(within(timeline).getAllByText("Reached")).toHaveLength(1);
        expect(screen.getAllByText(/Oct 1/).length).toBeGreaterThan(0);
        // Without crew data the panel still reads: no explainer paragraphs by default.
        expect(screen.queryByText(/Your contribution|Your part of the trail/)).toBeNull();
        expect(screen.queryByRole("list", {name: "Crew"})).toBeNull();
        expect(document.getElementById("expedition-help")).toBeNull();
    });

    it("paints the trail per crew member, shows weekly energy rings and today's pace flag", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                earned_points: 340,
                target_points: 800,
                pace_percent: 50,
                weekly_cap_per_person: 100,
                contributors: [
                    {id: 2, name: "Ada", is_you: false, profile_picture: null, points: 85, share_percent: 25, personal_progress_percent: 42.5, week_points: 40, week_energy_percent: 40},
                    {id: 1, name: "Zoe", is_you: true, profile_picture: "/api/users/1/picture/", points: 255, share_percent: 75, personal_progress_percent: 100, week_points: 100, week_energy_percent: 100},
                ],
                this_week: {start_date: "2026-10-05", end_date: "2026-10-11", earned_points: 140, possible_points: 200, cap_per_person: 100},
                next_milestone: {milestone_id: "high-pass", progress_percent: 60, opens_on: "2026-10-11", target_on: "2026-10-20", points_to_go: 140, time_gated: true},
            },
        });

        const {container} = render(<ExpeditionPanel competitionId={8}/>);

        // The trail behind the crew is split by contribution: 25% / 75% of the 42.5% travelled.
        const painted = Array.from(container.querySelectorAll('svg[role="img"] path[stroke-dashoffset]'));
        expect(painted.map((path) => path.getAttribute("stroke-dasharray"))).toEqual(["10.625 100", "31.875 100"]);
        expect(painted.map((path) => path.getAttribute("stroke-dashoffset"))).toEqual(["0", "-10.625"]);
        expect(painted[0].querySelector("title").textContent).toBe("Ada: 85 pts");
        // The crew stands on the trail together; "you" is outlined thicker.
        expect(container.querySelector('image[href="blob:/api/users/1/picture/"]')).toBeTruthy();
        expect(container.querySelector('image[href^="/api/"], img[src^="/api/"]')).toBeNull();
        expect(useProtectedImage).toHaveBeenCalledWith("/api/users/1/picture/", "avatar");
        // The crew list avatar rides the same blob.
        expect(container.querySelector('img[src="blob:/api/users/1/picture/"]')).toBeTruthy();
        expect(Array.from(container.querySelectorAll("svg title")).some((node) => node.textContent === "Today's pace marker")).toBe(true);
        // Weekly energy rings, one per member, and a plain "You" label instead of the name.
        const crew = screen.getByRole("list", {name: "Crew"});
        expect(within(crew).getByRole("img", {name: "Ada: weekly energy 40%"})).toBeTruthy();
        expect(within(crew).getByRole("img", {name: "Zoe: weekly energy 100%"})).toBeTruthy();
        expect(within(crew).getByText("You")).toBeTruthy();
        expect(within(crew).queryByText("Zoe")).toBeNull();
        // One short status line, no paragraphs; behind the flag reads as amber.
        expect(screen.getByText(/Crew 7.5% behind today's flag/)).toBeTruthy();
        expect(screen.getByText(/140 pts to High pass/)).toBeTruthy();
        expect(container.textContent).not.toMatch(/last place|rank|of the pool|How the Expedition works/);
    });

    it("dresses the same route in the season's theme and names landmarks from the API", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                route_theme: "ocean",
                route_title: "Ocean crossing",
                objective: "expedition",
                objective_title: "Expedition",
                landmark_titles: {trailhead: "Harbour", "river-crossing": "Open water", "high-pass": "Storm belt", finale: "Far shore"},
                next_milestone: {milestone_id: "high-pass", progress_percent: 60, opens_on: "2026-10-11", target_on: "2026-10-20", points_to_go: 140, time_gated: true},
            },
            error: undefined,
            isLoading: false,
        });
        render(<ExpeditionPanel competitionId={8}/>);
        expect(screen.getByText("Ocean crossing · 4 on the trail")).toBeTruthy();
        const timeline = screen.getByRole("list", {name: "Expedition milestones"});
        expect(within(timeline).getAllByText(/Harbour|Open water|Storm belt|Far shore/).length).toBe(4);
        expect(within(timeline).queryByText("Summit")).toBeNull();
        expect(screen.getByText(/pts to Storm belt/)).toBeTruthy();
    });

    it("shows the storm front and the lost stamp on a rescue run", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                objective: "rescue",
                objective_title: "Rescue run",
                storm_percent: 30,
                milestones: expedition.milestones.map((m) => m.milestone_id === "trailhead" ? {...m, stamped: false} : m),
            },
            error: undefined,
            isLoading: false,
        });
        const {container} = render(<ExpeditionPanel competitionId={8}/>);
        expect(screen.getByRole("heading", {name: "Rescue run"})).toBeTruthy();
        // 42.5% crew vs 30% storm -> 12.5% ahead.
        expect(screen.getByText("Storm 12.5% behind the crew")).toBeTruthy();
        const titles = Array.from(container.querySelectorAll("svg title")).map((node) => node.textContent);
        expect(titles).toContain("Storm front at 30%");
        expect(titles.some((t) => t.startsWith("Trailhead: reached late"))).toBe(true);
        expect(screen.getByText("Late")).toBeTruthy();
    });

    it("counts tents instead of distance at base camp", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                objective: "basecamp",
                objective_title: "Base camp",
                progress_percent: 50,
                camp: {tents: 2, held_weeks: 2, missed_weeks: 0, weeks_total: 4, this_week: {held: false, earned_points: 90, needed_points: 240}},
            },
            error: undefined,
            isLoading: false,
        });
        const {container} = render(<ExpeditionPanel competitionId={8}/>);
        expect(screen.getByText("150 pts to hold camp this week")).toBeTruthy();
        expect(screen.getByText(/2 of 4 weeks/)).toBeTruthy();
        const titles = Array.from(container.querySelectorAll("svg title")).map((node) => node.textContent);
        expect(titles.filter((t) => /^Tent \d standing$/.test(t)).length).toBe(2);
    });

    it("keeps unfound landmarks hidden on a treasure hunt and tells the latest chapter", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                objective: "treasure",
                objective_title: "Treasure hunt",
                milestones: expedition.milestones.map((m) => m.status === "completed"
                    ? {...m, story: `Found ${m.milestone_id}.`}
                    : {...m, hidden: true, title: "?"}),
                next_milestone: {milestone_id: "river-crossing", progress_percent: 25, opens_on: "2026-10-01", target_on: "2026-10-10", points_to_go: 40, time_gated: false},
            },
            error: undefined,
            isLoading: false,
        });
        render(<ExpeditionPanel competitionId={8}/>);
        const timeline = screen.getByRole("list", {name: "Expedition milestones"});
        expect(within(timeline).getAllByText("?").length).toBe(3);
        expect(within(timeline).getAllByText("Hidden").length).toBe(3);
        expect(within(timeline).queryByText("High pass")).toBeNull();
        expect(screen.getByRole("note").textContent).toContain("Found trailhead.");
        expect(screen.getByText(/Something ahead on the trail/)).toBeTruthy();
    });

    it("lets the crew vote on the shortcut week and shows the coach's line", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                twists: {
                    active: {kind: "shortcut", title: "Shortcut vote", coach_line: "Ridge or valley?", help: "Vote this week.", week_start: "2026-10-05", week_end: "2026-10-11"},
                    plan: [{week_start: "2026-10-05", kind: "shortcut", title: "Shortcut vote"}],
                    shortcut: {open: true, ridge_votes: 1, valley_votes: 0, your_vote: null, result: null, milestone_id: null},
                },
            },
            error: undefined,
            isLoading: false,
        });
        render(<ExpeditionPanel competitionId={8}/>);
        const chip = screen.getByRole("status", {name: "Shortcut vote"});
        expect(chip.textContent).toContain("Ridge or valley?");
        expect(within(chip).getByRole("button", {name: "ridge · 1"})).toBeTruthy();
        expect(within(chip).getByRole("button", {name: "valley"})).toBeTruthy();
        fireEvent.click(screen.getByRole("button", {name: "How the Expedition works"}));
        expect(screen.getByText(/Shortcut vote: Vote this week\./)).toBeTruthy();
    });

    it("announces a storm week without any vote buttons", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                weekly_cap_per_person: 150,
                twists: {
                    active: {kind: "storm", title: "Storm week", coach_line: "Bigger ring - fill it.", help: "150 points this week.", week_start: "2026-10-05", week_end: "2026-10-11"},
                    plan: [{week_start: "2026-10-05", kind: "storm", title: "Storm week"}],
                    shortcut: null,
                },
            },
            error: undefined,
            isLoading: false,
        });
        render(<ExpeditionPanel competitionId={8}/>);
        const chip = screen.getByRole("status", {name: "Storm week"});
        expect(chip.textContent).toContain("Bigger ring - fill it.");
        expect(within(chip).queryByRole("button")).toBeNull();
    });

    it("renders a one-line teaser that opens the Trail page", () => {
        const onOpen = vi.fn();
        const {container} = render(<ExpeditionTeaser expedition={{
            ...expedition,
            pace_percent: 30,
            contributors: [
                {id: 2, name: "Ada", points: 85, week_energy_percent: 40},
                {id: 1, name: "Zoe", is_you: true, points: 255, week_energy_percent: 100},
            ],
        }} onOpen={onOpen}/>);

        const button = screen.getByRole("button", {name: /Open the Expedition trail: Crew on pace, 42.5% of the route/});
        fireEvent.click(button);
        expect(onOpen).toHaveBeenCalledTimes(1);
        // Painted per member, crew faces on the line, no paragraphs of copy.
        expect(container.querySelectorAll("svg line[stroke='#0ea5e9'], svg line[stroke='#f59e0b']")).toHaveLength(2);
        expect(button.querySelector("span.shrink-0").textContent).toBe("Crew on pace42.5% · Trail ›");
        expect(screen.queryByRole("heading")).toBeNull();
    });

    it("renders nothing as a teaser when the Expedition is off", () => {
        const {container} = render(<ExpeditionTeaser expedition={{...expedition, enabled: false}} onOpen={() => {}}/>);
        expect(container.innerHTML).toBe("");
    });

    it("keeps the explanation behind the info button", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({data: {...expedition, weekly_cap_per_person: 100}});
        render(<ExpeditionPanel competitionId={8}/>);

        const button = screen.getByRole("button", {name: "How the Expedition works"});
        expect(button.getAttribute("aria-expanded")).toBe("false");
        expect(document.getElementById("expedition-help")).toBeNull();
        fireEvent.click(button);
        expect(button.getAttribute("aria-expanded")).toBe("true");
        expect(document.getElementById("expedition-help").textContent).toContain("100 points fill it");
    });

    it("shows a vector route map and an accessible landmark timeline", () => {
        render(<ExpeditionPanel competitionId={8}/>);

        expect(screen.getByRole("img", {
            name: "Shared route map, current position 42.5%",
        })).toBeTruthy();
        expect(screen.getByRole("list", {name: "Expedition milestones"})).toBeTruthy();
        const timeline = screen.getByRole("list", {name: "Expedition milestones"});
        expect(within(timeline).getByText("River crossing")).toBeTruthy();
    });

    it("shows a reviewed coach handover at the next uncompleted milestone", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                current_coach: {
                    ...expedition.current_coach,
                    avatar_asset_key: "zen",
                },
                coach_handover: {
                    from: {name: "Mira", avatar_asset_key: "captain"},
                    to: {name: "Juniper", avatar_asset_key: "zen"},
                    milestone_id: "river-crossing",
                },
            },
        });

        const {container} = render(<ExpeditionPanel competitionId={8}/>);

        expect(screen.getByRole("status", {name: "Coach handover"}).textContent)
            .toContain("Mira hands off to Juniper at River crossing");
        expect(container.querySelector('img[src="/personas/captain.svg"]')).toBeTruthy();
        expect(container.querySelector('img[src="/personas/zen.svg"]')).toBeTruthy();
    });

    it("falls back to accessible landmarks instead of loading an unapproved asset key", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                current_coach: {
                    name: "",
                    theme_color: "url(https://unsafe.invalid)",
                    avatar_asset_key: "../../uploads/unreviewed.svg",
                },
                milestones: [{
                    ...expedition.milestones[0],
                    milestone_id: "forest-cache",
                    approved_asset_key: "../../uploads/unreviewed.svg",
                    coach_snapshot: {name: "Mira", avatar_asset_key: "../../uploads/unreviewed.svg"},
                }],
            },
        });

        const {container} = render(<ExpeditionPanel competitionId={8}/>);

        expect(screen.getByText("forest cache")).toBeTruthy();
        expect(container.querySelector("img")).toBeNull();
        expect(container.innerHTML).not.toContain("unreviewed.svg");
        // Unapproved coach art falls back to the plain green tick, with the coach still in the tooltip.
        expect(screen.getByTitle("forest cache: Reached with Mira")).toBeTruthy();
    });

    it("shows the final postcard and lets only the organizer prepare a rematch", () => {
        const onRematch = vi.fn();
        useGetExpeditionByCompetitionQuery.mockReturnValue({
            data: {
                ...expedition,
                finale: {
                    final_date: "2026-10-30",
                    status: "final",
                    group_progress_percent: 42.5,
                    participant_count: 4,
                    personal_progress_percent: 65,
                },
            },
        });

        render(<ExpeditionPanel competitionId={8} canRematch onRematch={onRematch}/>);

        const postcard = screen.getByRole("region", {name: "Expedition postcard preview"});
        expect(postcard).toBeTruthy();
        expect(screen.getByRole("button", {name: "Prepare a rematch"})).toBeTruthy();
        expect(postcard.textContent).not.toContain("65");
    });

    it("stays out of challenges unless the pilot endpoint returns an enabled route", () => {
        useGetExpeditionByCompetitionQuery.mockReturnValue({error: {status: 404}});

        const {container} = render(<ExpeditionPanel competitionId={8}/>);

        expect(container.firstChild).toBeNull();
    });
});

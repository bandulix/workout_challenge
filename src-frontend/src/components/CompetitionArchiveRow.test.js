// @vitest-environment jsdom
import React from "react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import CompetitionArchiveRow from "./CompetitionArchiveRow";

const {navigate} = vi.hoisted(() => ({navigate: vi.fn()}));
vi.mock("react-router-dom", () => ({useNavigate: () => navigate}));
afterEach(cleanup);

const endedChallenge = {
    id: 42,
    name: "Autumn League",
    start_date: "2026-10-01",
    end_date: "2026-10-30",
    start_date_fmt: "Oct 1, 2026",
    end_date_fmt: "Oct 30, 2026",
    my_rank_summary: {my_rank: 2, started: true},
};

const now = new Date(2026, 9, 31, 12);

describe("CompetitionArchiveRow", () => {
    it("offers archive only for a completed challenge and keeps navigation available", () => {
        const onArchive = vi.fn();
        render(<CompetitionArchiveRow competition={endedChallenge} onArchive={onArchive} now={now}/>);

        expect(screen.getByRole("button", {name: "Archive Autumn League"})).toBeTruthy();
        fireEvent.click(screen.getByRole("button", {name: "Archive Autumn League"}));
        expect(onArchive).toHaveBeenCalledWith(42);
        fireEvent.click(screen.getByRole("button", {name: "Open challenge Autumn League"}));
        expect(navigate).toHaveBeenCalledWith("/competition/42");
    });

    it("does not offer archive before the challenge has ended", () => {
        render(<CompetitionArchiveRow
            competition={{...endedChallenge, end_date: "2026-10-31"}}
            onArchive={vi.fn()}
            now={now}
        />);

        expect(screen.queryByRole("button", {name: "Archive Autumn League"})).toBeNull();
    });

    it("offers restore for an archived challenge instead of archive", () => {
        const onRestore = vi.fn();
        render(<CompetitionArchiveRow competition={endedChallenge} archived onRestore={onRestore} now={now}/>);

        fireEvent.click(screen.getByRole("button", {name: "Restore Autumn League"}));
        expect(onRestore).toHaveBeenCalledWith(42);
        expect(screen.queryByRole("button", {name: "Archive Autumn League"})).toBeNull();
    });
});

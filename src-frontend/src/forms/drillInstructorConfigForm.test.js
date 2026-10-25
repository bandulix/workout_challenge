// @vitest-environment jsdom
import React from "react";
import {fireEvent, render, screen} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import DrillInstructorConfigForm from "./drillInstructorConfigForm";

const {addDrillConfig} = vi.hoisted(() => ({
    addDrillConfig: vi.fn(() => ({unwrap: () => Promise.resolve({})})),
}));

vi.mock("../utils/reducers/readinessSlice", () => ({
    useGetChallengeReadinessQuery: () => ({data: undefined, isError: true}),
    useUpdateChallengeReadinessMutation: () => [vi.fn(), {isLoading: false}],
}));

vi.mock("../utils/reducers/drillInstructorSlice", () => ({
    useAddDrillConfigMutation: () => [addDrillConfig, {isLoading: false}],
    useDeleteDrillConfigMutation: () => [vi.fn(), {isLoading: false}],
    useGetDrillConfigsQuery: () => ({data: [], isLoading: false, refetch: vi.fn()}),
    useGetPersonasQuery: () => ({data: [{id: 3, name: "Drill Sergeant", tagline: "Move"}], isLoading: false, refetch: vi.fn()}),
    useRunTestMessageMutation: () => [vi.fn(), {isLoading: false}],
    useUpdateDrillConfigMutation: () => [vi.fn(), {isLoading: false}],
}));

describe("DrillInstructorConfigForm", () => {
    it("keeps per-workout comments on and leaves nudges and pep talks retired", () => {
        render(
            <DrillInstructorConfigForm competition={{id: 7, name: "Spring challenge"}} setModalState={vi.fn()}/>,
        );

        expect(screen.getByText(/Browser push on standings and Echo changes/i)).toBeInTheDocument();
        expect(screen.getByText(/Comments on every workout stay on/i)).toBeInTheDocument();
        expect(screen.queryByText(/Nudge when the group goes quiet/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Pep talks at random times/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Daily briefing/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/are retired/i)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", {name: "Drill Sergeant"}));
        fireEvent.click(screen.getByRole("button", {name: "Activate"}));
        expect(addDrillConfig).toHaveBeenCalledWith(expect.objectContaining({
            comment_on_activity: true,
            nudge_on_inactivity: false,
            random_push: false,
            enabled: true,
            persona: 3,
        }));
    });
});

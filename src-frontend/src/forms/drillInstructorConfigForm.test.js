// @vitest-environment jsdom
import React from "react";
import {render, screen} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import DrillInstructorConfigForm from "./drillInstructorConfigForm";

vi.mock("../utils/reducers/drillInstructorSlice", () => ({
    useAddDrillConfigMutation: () => [vi.fn(), {isLoading: false}],
    useDeleteDrillConfigMutation: () => [vi.fn(), {isLoading: false}],
    useGetDrillConfigsQuery: () => ({data: [], isLoading: false, refetch: vi.fn()}),
    useGetPersonasQuery: () => ({data: [], isLoading: false, refetch: vi.fn()}),
    useRunTestMessageMutation: () => [vi.fn(), {isLoading: false}],
    useUpdateDrillConfigMutation: () => [vi.fn(), {isLoading: false}],
}));

describe("DrillInstructorConfigForm", () => {
    it("offers only event-driven coach push settings, not generic chatter controls", () => {
        render(
            <DrillInstructorConfigForm competition={{id: 7, name: "Spring challenge"}} setModalState={vi.fn()}/>,
        );

        expect(screen.getByText(/Browser push on standings and Echo changes/i)).toBeInTheDocument();
        expect(screen.queryByText(/Comment on each workout/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Nudge when the group goes quiet/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Pep talks at random times/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Daily briefing/i)).not.toBeInTheDocument();
    });
});

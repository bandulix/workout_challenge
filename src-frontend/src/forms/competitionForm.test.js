// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";

afterEach(cleanup);
import CompetitionForm from "./competitionForm";

const {createEntry, navigate} = vi.hoisted(() => ({createEntry: vi.fn(), navigate: vi.fn()}));

vi.mock("react-router-dom", () => ({useNavigate: () => navigate}));
vi.mock("../utils/reducers/competitionsSlice", () => ({
    useAddCompetitionMutation: () => [createEntry, {}],
    useDeleteCompetitionMutation: () => [vi.fn(), {}],
    useUpdateCompetitionMutation: () => [vi.fn(), {}],
}));
vi.mock("./basicComponents", () => ({
    ChangeOwnerButton: () => null,
    DeleteButton: () => null,
    Modal: ({children, title}) => <section role="dialog" aria-label={title}>{children}</section>,
    SaveButton: () => null,
    SingleForm: ({fields, values}) => (
        <>
            <pre data-testid="form-values">{JSON.stringify(values)}</pre>
            <pre data-testid="form-fields">{JSON.stringify(Object.keys(fields))}</pre>
            <pre data-testid="form-field-defs">{JSON.stringify(fields)}</pre>
        </>
    ),
    useFormDirty: () => false,
}));
vi.mock("../utils/dialogs", () => ({confirmAction: vi.fn()}));
vi.mock("../utils/toasts", () => ({toast: {success: vi.fn()}}));
vi.mock("../utils/overlay", () => ({clearBodyScrollLock: vi.fn()}));
vi.mock("../utils/errors", () => ({errText: vi.fn(() => "error")}));

describe("CompetitionForm rematch setup", () => {
    it("loads a reviewed rematch seed into a create form without creating it", () => {
        const seed = {
            name: "Autumn Challenge · Rematch",
            start_date: "2026-11-01",
            end_date: "2026-11-30",
            has_teams: true,
            organizer_assigns_teams: false,
        };

        render(<CompetitionForm initialValues={seed} isRematch setModalState={vi.fn()}/>);

        expect(screen.getByTestId("form-values").textContent).toBe(JSON.stringify(seed));
        expect(createEntry).not.toHaveBeenCalled();
        expect(screen.getByText(/Previous members are not added automatically/)).toBeTruthy();
    });
});

describe("CompetitionForm Expedition settings", () => {
    const fieldNames = () => JSON.parse(screen.getByTestId("form-fields").textContent);

    it("hides objective and route until the owner switches the Expedition on", () => {
        render(<CompetitionForm competition={{id: 4, name: "Plain", expedition_enabled: false}} setModalState={vi.fn()}/>);
        const names = fieldNames();
        expect(names).toContain("expedition_enabled");
        expect(names).not.toContain("expedition_objective");
        expect(names).not.toContain("expedition_theme");
    });

    it("offers every objective and route once the Expedition is on", () => {
        render(<CompetitionForm competition={{id: 4, name: "Trail", expedition_enabled: true, expedition_objective: "basecamp", expedition_theme: ""}} setModalState={vi.fn()}/>);
        const fields = JSON.parse(screen.getByTestId("form-field-defs").textContent);
        expect(fields.expedition_objective.selectList.map((o) => o.value)).toEqual(["expedition", "rescue", "basecamp", "treasure"]);
        expect(fields.expedition_theme.selectList.map((o) => o.value)).toEqual(["", "summit", "ocean", "desert", "space", "relay"]);
        expect(fields.expedition_objective.readOnly).toBeFalsy();
    });

    it("shows objective and route read-only once the route is locked", () => {
        render(<CompetitionForm competition={{id: 4, name: "Started", expedition_enabled: true, expedition_objective: "rescue", expedition_theme: "space", expedition_locked: true}} setModalState={vi.fn()}/>);
        const fields = JSON.parse(screen.getByTestId("form-field-defs").textContent);
        expect(fields.expedition_objective.readOnly).toBe(true);
        expect(fields.expedition_theme.readOnly).toBe(true);
        expect(fields.expedition_objective.label).toMatch(/locked/);
    });
});

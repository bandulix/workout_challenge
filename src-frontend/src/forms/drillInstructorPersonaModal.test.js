// @vitest-environment jsdom
import React from "react";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {COACH_LANGUAGES, PersonaEditModal} from "./drillInstructorPersonaModal";

vi.mock("../utils/reducers/drillInstructorSlice", () => ({
    useAddPersonaMutation: () => [vi.fn(), {isLoading: false, error: null, isSuccess: false}],
    useUpdatePersonaMutation: () => [vi.fn(), {isLoading: false, error: null, isSuccess: false}],
    useTransferPersonaMutation: () => [vi.fn(), {isLoading: false}],
    useDeletePersonaMutation: () => [vi.fn(), {isLoading: false}],
    useGetPersonasQuery: () => ({data: [], isLoading: false, refetch: vi.fn()}),
}));

vi.mock("../utils/reducers/usersSlice", () => ({
    useGetUserByIdQuery: () => ({data: {id: 1, is_staff: false}}),
    useGetUsersQuery: () => ({data: []}),
}));

beforeEach(() => {
    window.scrollTo = () => {};
    window.matchMedia = (query) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    });
});

// The coach editor is portaled onto document.body. Drop it between cases
// so a later example does not read the previous coach's select.
afterEach(() => {
    cleanup();
});

describe("PersonaEditModal reply language", () => {
    it("defaults a new coach to English and lists language names", () => {
        render(<PersonaEditModal persona={{}} setModalState={vi.fn()}/>);
        const select = screen.getByLabelText(/Reply language/i);
        expect(select).toHaveValue("en");
        const names = COACH_LANGUAGES.map(([, name]) => name);
        expect(names).toEqual([
            "English", "German", "Spanish", "French", "Portuguese", "Italian",
            "Dutch", "Polish", "Turkish", "Russian", "Arabic", "Hindi",
            "Japanese", "Korean", "Chinese",
        ]);
        for (const name of names) {
            expect(screen.getByRole("option", {name})).toBeInTheDocument();
        }
        expect(screen.queryByRole("option", {name: "de"})).not.toBeInTheDocument();
        expect(screen.getByText(/answers in English/i)).toBeInTheDocument();
    });

    it("shows the saved language name for this coach", () => {
        render(<PersonaEditModal persona={{id: 4, language: "de", name: "Sarge"}} setModalState={vi.fn()}/>);
        expect(screen.getByLabelText(/Reply language/i)).toHaveValue("de");
        expect(screen.getByRole("option", {name: "German"}).selected).toBe(true);
        expect(screen.getByText(/answers in German/i)).toBeInTheDocument();
    });
});

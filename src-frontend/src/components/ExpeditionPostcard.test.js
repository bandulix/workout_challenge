// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import ExpeditionPostcard from "./ExpeditionPostcard";

const finale = {
    final_date: "2026-10-30",
    status: "final",
    group_progress_percent: 42.5,
    participant_count: 4,
    personal_progress_percent: 65,
    coach_snapshot: {name: "Juniper"},
};

let share;

describe("ExpeditionPostcard", () => {
    beforeEach(() => {
        share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "share", {configurable: true, value: share});
    });

    afterEach(() => {
        cleanup();
        delete navigator.share;
    });

    it("previews only group-safe finale details before any explicit share", () => {
        render(<ExpeditionPostcard title="Autumn Challenge" finale={finale}/>);

        expect(screen.getByRole("region", {name: "Expedition postcard preview"})).toBeTruthy();
        expect(screen.getByText("Autumn Challenge")).toBeTruthy();
        expect(screen.getByText(/42.5% of the shared route/)).toBeTruthy();
        expect(screen.queryByText(/65/)).toBeNull();
        expect(screen.queryByText(/Juniper/)).toBeNull();
        expect(share).not.toHaveBeenCalled();
    });

    it("shares only the privacy-conscious postcard summary after the user confirms", async () => {
        render(<ExpeditionPostcard title="Autumn Challenge" finale={finale}/>);

        fireEvent.click(screen.getByRole("button", {name: "Share postcard"}));

        expect(share).toHaveBeenCalledTimes(1);
        const payload = share.mock.calls[0][0];
        expect(payload.title).toMatch(/Autumn Challenge/);
        expect(payload.text).toContain("42.5% of the shared route");
        expect(payload.text).toContain("4 participants");
        expect(payload.text).not.toContain("65");
        expect(payload.text).not.toContain("Juniper");
    });

    it("offers an explicit organizer rematch callback without creating anything on render", () => {
        const onRematch = vi.fn();
        render(<ExpeditionPostcard title="Autumn Challenge" finale={finale} canRematch onRematch={onRematch}/>);

        const button = screen.getByRole("button", {name: "Prepare a rematch"});
        expect(onRematch).not.toHaveBeenCalled();
        fireEvent.click(button);
        expect(onRematch).toHaveBeenCalledTimes(1);
    });
});

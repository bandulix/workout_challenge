// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {ApresBoard, ChampReveal, SambucaSheet} from "./SambucaDesk";

afterEach(cleanup);

const skiweek = {
    resort: {name: "Zermatt"},
    today: {
        sambuca_mine: 4,
        logs: [
            {id: 1, kind: "sambuca", amount: 2, logged_at: "2026-02-09T21:10:00+01:00"},
            {id: 2, kind: "water", amount: 1, logged_at: "2026-02-09T21:12:00+01:00"},
        ],
    },
    board: {
        day: [
            {user_id: 1, username: "Lena", punkte: 40, elevation_m: 1800, sambuca: 4},
            {user_id: 2, username: "Mats", punkte: 22, elevation_m: 900, sambuca: 4},
        ],
        week: [
            {user_id: 2, username: "Mats", punkte: 80, elevation_m: 3200, sambuca: 9},
        ],
    },
    yesterday: {
        resort_day: "2026-02-08",
        count: 4,
        tied: true,
        users: [{user_id: 1, username: "Lena"}, {user_id: 2, username: "Mats"}],
    },
};

describe("Sambuca desk", () => {
    it("adds from the quick buttons and undoes the last entry", () => {
        const onAdd = vi.fn();
        const onUndo = vi.fn();
        render(<SambucaSheet skiweek={skiweek} onClose={vi.fn()} onAdd={onAdd} onUndo={onUndo}/>);
        expect(screen.getByText("4")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", {name: "+2"}));
        expect(onAdd).toHaveBeenCalledWith(2);
        fireEvent.click(screen.getByRole("button", {name: "Undo last"}));
        expect(onUndo).toHaveBeenCalled();
        expect(screen.getAllByText("+2").length).toBeGreaterThan(0);
        expect(screen.getByText("21:10")).toBeTruthy();
    });

    it("switches the Après board between Sambuca, piste and the week", () => {
        render(<ApresBoard skiweek={skiweek}/>);
        expect(screen.getByText("Lena")).toBeTruthy();
        fireEvent.click(screen.getByRole("tab", {name: "Piste"}));
        expect(screen.getByText("1800")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", {name: "Week"}));
        expect(screen.getByText("Mats")).toBeTruthy();
        expect(screen.queryByText("Lena")).toBeNull();
    });

    it("names every athlete who shares the crown", () => {
        render(<ChampReveal skiweek={skiweek} onClose={vi.fn()}/>);
        expect(screen.getByText(/Lena and Mats share the crown/)).toBeTruthy();
        expect(screen.queryByText(/drink/i)).toBeNull();
    });
});

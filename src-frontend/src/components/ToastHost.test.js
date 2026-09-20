// @vitest-environment jsdom
import React from "react";
import {render, screen, act, cleanup} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vitest";
import ToastHost from "./ToastHost";
import {toast} from "../utils/toasts";

afterEach(cleanup);

// Component-test smoke proof: the jsdom + testing-library stack renders
// the toast pipeline end to end (event -> host -> card).
describe("ToastHost", () => {
    it("renders a dispatched toast and closes it on tap", async () => {
        render(<ToastHost/>);
        act(() => {
            toast.success("Saved nicely");
        });
        const card = await screen.findByText("Saved nicely");
        expect(card).toBeInTheDocument();
        act(() => {
            card.closest("button").click();
        });
        expect(screen.queryByText("Saved nicely")).not.toBeInTheDocument();
    });

    it("caps the visible stack at three", async () => {
        render(<ToastHost/>);
        act(() => {
            for (let i = 1; i <= 5; i++) toast(`message ${i}`);
        });
        expect(await screen.findByText("message 5")).toBeInTheDocument();
        expect(screen.queryByText("message 1")).not.toBeInTheDocument();
        expect(screen.queryByText("message 2")).not.toBeInTheDocument();
    });
});

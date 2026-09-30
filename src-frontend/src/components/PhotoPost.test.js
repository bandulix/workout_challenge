// @vitest-environment jsdom
import React from "react";
import {afterEach, describe, expect, it} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {Provider} from "react-redux";
import PhotoPost from "./PhotoPost";
import store from "../utils/store";

afterEach(cleanup);

function renderPhotoPost(props) {
    return render(
        <Provider store={store}>
            <PhotoPost competitionId={7} visionCapable parentId={42} {...props}/>
        </Provider>,
    );
}

describe("PhotoPost purpose gating", () => {
    it("does not render a camera control without a contextual purpose", () => {
        renderPhotoPost({});
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("explains the Echo relic before mounting camera or gallery controls", () => {
        renderPhotoPost({purpose: "echo", variant: "chip"});
        const action = screen.getByRole("button", {name: "Capture Echo relic"});
        expect(action.textContent).not.toContain("10P");
        fireEvent.click(action);
        expect(screen.getByText("This photo makes the Echo a visible relic. Without it, the Echo stays off the board.")).not.toBeNull();
        expect(screen.getByRole("button", {name: "Continue to camera or gallery"})).not.toBeNull();
        expect(screen.queryByLabelText("Take a photo")).toBeNull();
        expect(screen.queryByLabelText("Choose from gallery")).toBeNull();
    });

    it("uses photo-order purpose when there is no Echo action", () => {
        renderPhotoPost({purpose: "photo_order", variant: "chip"});
        const action = screen.getByRole("button", {name: "Complete today's photo order"});
        fireEvent.click(action);
        expect(screen.getByText("This photo completes today's order; it does not add flat points.")).not.toBeNull();
    });
});

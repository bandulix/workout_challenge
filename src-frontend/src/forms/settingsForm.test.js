// @vitest-environment jsdom
import React from "react";
import {render, screen, fireEvent, cleanup, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi, beforeEach} from "vitest";

// Control the RTK mutation + router so the section can be tested in
// isolation (the full settings modal needs the whole store).
const updateUserMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../utils/reducers/usersSlice", () => ({
    useUpdateUserMutation: () => [updateUserMock, {isLoading: false}],
    usersApi: {util: {invalidateTags: vi.fn()}},
    useDeleteUserMutation: () => [vi.fn(), {}],
}));

vi.mock("react-router-dom", () => ({
    useNavigate: () => navigateMock,
}));

vi.mock("../utils/nativeHealth", () => ({
    isNativeHealthAvailable: () => false,
    nativeHealthConnect: vi.fn(),
    nativeHealthDisconnect: vi.fn(),
    nativeHealthSetSource: vi.fn(),
}));

import {PasswordSection} from "./settingsForm";

afterEach(cleanup);
beforeEach(() => {
    updateUserMock.mockReset();
    navigateMock.mockReset();
});

function fill({current = "Old-Pass-123!", next = "New-Pass-456!", repeat} = {}) {
    fireEvent.change(screen.getByLabelText("Current password"), {target: {value: current}});
    fireEvent.change(screen.getByLabelText("New password"), {target: {value: next}});
    fireEvent.change(screen.getByLabelText("New password (repeat)"), {target: {value: repeat ?? next}});
}

describe("PasswordSection", () => {
    it("blocks submit until all three fields are filled", () => {
        render(<PasswordSection/>);
        expect(screen.getByRole("button", {name: /change password/i})).toBeDisabled();
        fill();
        expect(screen.getByRole("button", {name: /change password/i})).toBeEnabled();
    });

    it("shows a mismatch error and never calls the API when the new passwords differ", () => {
        render(<PasswordSection/>);
        fill({repeat: "Something-Else-789!"});
        fireEvent.click(screen.getByRole("button", {name: /change password/i}));
        expect(screen.getByText("The new passwords do not match.")).toBeInTheDocument();
        expect(updateUserMock).not.toHaveBeenCalled();
    });

    it("sends current + new password and logs out on success", async () => {
        updateUserMock.mockReturnValue({unwrap: () => Promise.resolve({})});
        render(<PasswordSection/>);
        fill();
        fireEvent.click(screen.getByRole("button", {name: /change password/i}));
        await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/logout"));
        expect(updateUserMock).toHaveBeenCalledWith({
            id: "me", current_password: "Old-Pass-123!", password: "New-Pass-456!",
        });
    });

    it("surfaces the server's current_password error", async () => {
        updateUserMock.mockReturnValue({
            unwrap: () => Promise.reject({data: {current_password: ["Current password is required and must be correct."]}}),
        });
        render(<PasswordSection/>);
        fill();
        fireEvent.click(screen.getByRole("button", {name: /change password/i}));
        expect(await screen.findByText("Current password is required and must be correct.")).toBeInTheDocument();
        expect(navigateMock).not.toHaveBeenCalled();
    });
});

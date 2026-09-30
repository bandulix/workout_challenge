// @vitest-environment jsdom
import React from "react";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import ProfileAvatar from "./ProfileAvatar";

vi.mock("../utils/reducers/usersSlice", () => ({
    useUploadProfilePictureMutation: () => [vi.fn(), {isLoading: false}],
}));
vi.mock("../utils/protectedMedia", () => ({
    invalidateProtectedImage: vi.fn(),
    useProtectedImage: () => ({src: null, failed: false}),
}));

afterEach(cleanup);

describe("ProfileAvatar", () => {
    it("never displays the legacy public last-place marker", () => {
        render(<ProfileAvatar user={{first_name: "Nina"}} size={48} dunce/>);

        expect(screen.getByAltText("Nina's profile picture")).toBeTruthy();
        expect(screen.queryByTitle(/last on the board/i)).toBeNull();
    });
});

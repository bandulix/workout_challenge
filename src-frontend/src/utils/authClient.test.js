import {beforeEach, describe, expect, it, vi} from "vitest";

const dispatch = vi.fn();
vi.mock("./store", () => ({default: {dispatch: (...args) => dispatch(...args)}}));
vi.mock("./reducers/usersSlice", () => ({
    usersApi: {endpoints: {login: {initiate: (body) => ({type: "login", body})}}},
}));
vi.mock("./reducers/baseQueryWithReauth", () => ({sentryError: vi.fn()}));
vi.mock("./authTokens", () => ({
    applyAuthResponse: vi.fn(),
    clearAuthSession: vi.fn(),
    ensureFreshAccessToken: vi.fn(),
    getAccessToken: vi.fn(),
}));

import {apiLogin, sanitizeRedirect} from "./authClient";

describe("apiLogin error text", () => {
    beforeEach(() => dispatch.mockReset());

    it("surfaces the DRF detail without status soup", async () => {
        dispatch.mockResolvedValue({error: {status: 401, data: {detail: "No active account found with the given credentials"}}});
        expect(await apiLogin("A@B.c", "pw")).toEqual([false, "No active account found with the given credentials"]);
        expect(dispatch).toHaveBeenCalledWith({type: "login", body: {email: "a@b.c", password: "pw"}});
    });

    it("joins field errors and maps network failures to a sentence", async () => {
        dispatch.mockResolvedValueOnce({error: {status: 400, data: {non_field_errors: ["Too short.", "Try again."]}}});
        expect(await apiLogin("a@b.c", "pw")).toEqual([false, "Too short. Try again."]);
        dispatch.mockResolvedValueOnce({error: {status: "FETCH_ERROR", error: "TypeError: Failed to fetch"}});
        const [ok, msg] = await apiLogin("a@b.c", "pw");
        expect(ok).toBe(false);
        expect(msg).toMatch(/No connection to the server/);
        expect(msg).not.toMatch(/FETCH_ERROR|\(\d+\)/);
    });
});

describe("sanitizeRedirect", () => {
    it("keeps same-origin paths, including ones with a literal percent", () => {
        expect(sanitizeRedirect("/dashboard")).toBe("/dashboard");
        expect(sanitizeRedirect("/competition/4?q=100%")).toBe("/competition/4?q=100%");
        expect(sanitizeRedirect("/search?q=a%2Fb")).toBe("/search?q=a%2Fb");
    });

    it("rejects anything that could leave the origin", () => {
        expect(sanitizeRedirect(null)).toBeNull();
        expect(sanitizeRedirect("")).toBeNull();
        expect(sanitizeRedirect("https://evil.example")).toBeNull();
        expect(sanitizeRedirect("//evil.example")).toBeNull();
        expect(sanitizeRedirect("/\\evil.example")).toBeNull();
        expect(sanitizeRedirect("/javascript:alert(1)")).toBeNull();
        expect(sanitizeRedirect("dashboard")).toBeNull();
    });
});

import {describe, expect, it} from "vitest";
import {errText} from "./errors";

describe("errText", () => {
    it("returns the fallback for empty errors", () => {
        expect(errText(undefined)).toBe("Something went wrong. Please try again.");
        expect(errText(null, "Nope.")).toBe("Nope.");
    });

    it("maps network failures to connection copy", () => {
        expect(errText({status: "FETCH_ERROR"})).toMatch(/no connection/i);
        expect(errText({status: "TIMEOUT_ERROR"})).toMatch(/not answering/i);
    });

    it("maps rate limits", () => {
        expect(errText({status: 429, data: {}})).toMatch(/too many attempts/i);
    });

    it("prefers DRF detail over field errors", () => {
        expect(errText({status: 400, data: {detail: "Invite token invalid."}})).toBe("Invite token invalid.");
        expect(errText({status: 400, data: {message: "Nope", detail: "Detail wins"}})).toBe("Detail wins");
    });

    it("surfaces the first field error", () => {
        expect(errText({status: 400, data: {email: ["This field is required."]}})).toBe("This field is required.");
        expect(errText({status: 400, data: {name: "Too short"}})).toBe("Too short");
    });

    it("never shows HTML error pages", () => {
        const html = "<html><body><h1>500 Server Error</h1></body></html>";
        expect(errText({status: 500, data: html})).toBe("Something went wrong. Please try again.");
        expect(errText({status: 500, data: "<!doctype html>..."})).toBe("Something went wrong. Please try again.");
    });

    it("caps over-long string payloads", () => {
        expect(errText({status: 500, data: "x".repeat(500)})).toBe("Something went wrong. Please try again.");
    });

    it("passes through short plain-text messages", () => {
        expect(errText({status: 400, data: "Bad invite link."})).toBe("Bad invite link.");
    });
});

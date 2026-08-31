import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@capacitor/core", () => ({
    Capacitor: {
        isNativePlatform: () => false,
        isPluginAvailable: () => false,
        convertFileSrc: (p) => p,
    },
    CapacitorHttp: {get: vi.fn()},
    registerPlugin: () => ({}),
}));
vi.mock("./serverUrl", () => ({
    getServerUrl: () => "https://challenge.example.com",
    isNativeApp: () => false,
}));
vi.mock("./authTokens", () => ({
    ensureFreshAccessToken: async () => "ok",
    getAccessToken: () => "tok",
    refreshAccessToken: async () => "ok",
}));

import {
    clearProtectedImageCache,
    fetchProtectedImage,
    pictureResponseIsBanRisk,
    pictureResponseIsEmpty,
} from "./protectedMedia";

describe("pictureResponseIsEmpty", () => {
    it("treats 204 and 4xx as no image so the UI falls back", () => {
        expect(pictureResponseIsEmpty(204)).toBe(true);
        expect(pictureResponseIsEmpty(400)).toBe(true);
        expect(pictureResponseIsEmpty(403)).toBe(true);
        expect(pictureResponseIsEmpty(404)).toBe(true);
        expect(pictureResponseIsEmpty(200)).toBe(false);
        expect(pictureResponseIsEmpty(304)).toBe(false);
    });
});

describe("pictureResponseIsBanRisk", () => {
    it("flags the 4xx CrowdSec http-probing counts", () => {
        expect(pictureResponseIsBanRisk(400)).toBe(true);
        expect(pictureResponseIsBanRisk(403)).toBe(true);
        expect(pictureResponseIsBanRisk(404)).toBe(true);
        expect(pictureResponseIsBanRisk(204)).toBe(false);
        expect(pictureResponseIsBanRisk(401)).toBe(false);
        expect(pictureResponseIsBanRisk(200)).toBe(false);
    });
});

describe("fetchProtectedImage CrowdSec hygiene", () => {
    let fetchMock;

    beforeEach(() => {
        clearProtectedImageCache();
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        clearProtectedImageCache();
        vi.unstubAllGlobals();
    });

    it("treats 204 as no image and does not refetch it", async () => {
        fetchMock.mockResolvedValue({status: 204, ok: true, blob: async () => { throw new Error("no body"); }});
        expect(await fetchProtectedImage("/api/user/1/picture/", "avatar")).toBeNull();
        expect(await fetchProtectedImage("/api/user/1/picture/", "avatar")).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry 403s on remount (http-probing burst)", async () => {
        fetchMock.mockResolvedValue({status: 403, ok: false, blob: async () => { throw new Error("no body"); }});
        const urls = [
            "/api/user/1/picture/",
            "/api/user/2/picture/",
            "/api/user/5/picture/",
            "/api/drill-instructor/persona/10/picture/",
            "/api/drill-instructor/persona/12/picture/",
            "/api/drill-instructor/message/420/picture/",
        ];
        await Promise.all(urls.map((u) => fetchProtectedImage(u, "avatar")));
        await Promise.all(urls.map((u) => fetchProtectedImage(u, "avatar")));
        expect(fetchMock).toHaveBeenCalledTimes(urls.length);
    });
});

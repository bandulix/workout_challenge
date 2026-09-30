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
    MAX_CACHED_IMAGES,
    pictureResponseIsBanRisk,
    pictureResponseIsEmpty,
    protectedImageCacheOrder,
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

describe("fetchProtectedImage LRU cache", () => {
    let fetchMock;
    let created;
    let revoked;

    beforeEach(() => {
        clearProtectedImageCache();
        created = 0;
        revoked = [];
        fetchMock = vi.fn().mockResolvedValue({status: 200, ok: true, blob: async () => new Blob(["x"])});
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: () => `blob:img-${++created}`,
            revokeObjectURL: (u) => revoked.push(u),
        });
    });
    afterEach(() => {
        clearProtectedImageCache();
        vi.unstubAllGlobals();
    });

    it("moves a hit to the tail so the on-screen image is not evicted first", async () => {
        await fetchProtectedImage("/api/user/1/picture/");
        await fetchProtectedImage("/api/user/2/picture/");
        await fetchProtectedImage("/api/user/3/picture/");
        expect(protectedImageCacheOrder()).toEqual(["/api/user/1/picture/", "/api/user/2/picture/", "/api/user/3/picture/"]);

        // A cache hit is not a refetch, but it is a "recently used".
        expect(await fetchProtectedImage("/api/user/1/picture/")).toBe("blob:img-1");
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(protectedImageCacheOrder()).toEqual(["/api/user/2/picture/", "/api/user/3/picture/", "/api/user/1/picture/"]);
    });

    it("evicts the least recently used entry, not the first fetched", async () => {
        for (let i = 1; i <= MAX_CACHED_IMAGES; i += 1) {
            await fetchProtectedImage(`/api/user/${i}/picture/`);
        }
        // Touch the oldest right before the cache overflows.
        const first = await fetchProtectedImage("/api/user/1/picture/");
        await fetchProtectedImage("/api/user/new/picture/");
        await Promise.resolve(); // revokeBlob resolves the evicted entry asynchronously

        const order = protectedImageCacheOrder();
        expect(order).toHaveLength(MAX_CACHED_IMAGES);
        expect(order).toContain("/api/user/1/picture/");
        expect(order).not.toContain("/api/user/2/picture/");
        expect(revoked).toEqual(["blob:img-2"]);
        expect(revoked).not.toContain(first);
    });
});

import {describe, expect, it} from "vitest";
import {
    APK_GATE_TTL_MS,
    apkGateCachedUpdate,
    apkGateNeedsCheck,
    apkGateShouldSplash,
    apkManifestUrls,
    parseApkGateCache,
    parseApkManifest,
} from "./apkUpdate";

const ORIGIN = "https://challenge.example.com";

function cache(over = {}) {
    return parseApkGateCache({
        origin: ORIGIN,
        currentCode: 10,
        latestCode: 10,
        checkedAt: 1_000_000,
        currentName: "0.48.0",
        versionName: "0.48.0",
        ...over,
    });
}

describe("parseApkGateCache", () => {
    it("drops incomplete or junk records", () => {
        expect(parseApkGateCache(null)).toBeNull();
        expect(parseApkGateCache("nope")).toBeNull();
        expect(parseApkGateCache({origin: ORIGIN, currentCode: 1})).toBeNull();
        expect(parseApkGateCache({origin: "", currentCode: 1, latestCode: 2, checkedAt: 1})).toBeNull();
    });
});

describe("apkGateShouldSplash", () => {
    it("skips the splash when this origin last said the build is current", () => {
        expect(apkGateShouldSplash(cache(), {origin: ORIGIN})).toBe(false);
        expect(apkGateShouldSplash(cache(), {origin: ORIGIN, now: 1_000_000 + APK_GATE_TTL_MS})).toBe(false);
        expect(apkGateNeedsCheck(cache(), {origin: ORIGIN})).toBe(false);
    });

    it("splashes on first run, another server, or when last seen behind", () => {
        expect(apkGateShouldSplash(cache(), {origin: "https://other.example"})).toBe(true);
        expect(apkGateShouldSplash(cache({latestCode: 11}), {origin: ORIGIN})).toBe(true);
        expect(apkGateShouldSplash(null, {origin: ORIGIN})).toBe(true);
        expect(apkGateShouldSplash(cache(), {origin: ""})).toBe(true);
    });
});

describe("apkGateCachedUpdate", () => {
    it("hydrates the download screen from a known-outdated cache", () => {
        const behind = cache({currentCode: 10, latestCode: 12});
        expect(apkGateCachedUpdate(behind, ORIGIN)).toEqual(behind);
        expect(apkGateCachedUpdate(cache(), ORIGIN)).toBeNull();
        expect(apkGateCachedUpdate(behind, "https://other.example")).toBeNull();
    });
});

describe("apkManifestUrls", () => {
    it("tries the nginx file first, then the CORS API copy", () => {
        expect(apkManifestUrls()).toEqual([
            "/download/apk-version.json",
            "/api/apk-version/",
        ]);
    });
});

describe("parseApkManifest", () => {
    it("keeps a published versionCode and drops junk", () => {
        expect(parseApkManifest({versionName: "0.52.0", versionCode: 156})).toEqual({
            latestCode: 156,
            versionName: "0.52.0",
        });
        expect(parseApkManifest({versionCode: "156"})).toEqual({
            latestCode: 156,
            versionName: "",
        });
        expect(parseApkManifest(null)).toBeNull();
        expect(parseApkManifest({versionName: "0.52.0"})).toBeNull();
        expect(parseApkManifest({versionCode: 0})).toBeNull();
    });
});

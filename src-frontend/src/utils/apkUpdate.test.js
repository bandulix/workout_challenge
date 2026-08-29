import {describe, expect, it} from "vitest";
import {
    APK_GATE_TTL_MS,
    apkGateNeedsCheck,
    parseApkGateCache,
} from "./apkUpdate";

const ORIGIN = "https://challenge.example.com";
const HOUR = 60 * 60 * 1000;

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

describe("apkGateNeedsCheck", () => {
    it("skips the network when this origin said the build is current within 24h", () => {
        expect(apkGateNeedsCheck(cache(), {origin: ORIGIN, now: 1_000_000 + 23 * HOUR})).toBe(false);
        expect(apkGateNeedsCheck(cache(), {origin: ORIGIN, now: 1_000_000 + APK_GATE_TTL_MS - 1})).toBe(false);
    });

    it("rechecks after 24h, on another server, or when last seen behind", () => {
        expect(apkGateNeedsCheck(cache(), {origin: ORIGIN, now: 1_000_000 + APK_GATE_TTL_MS})).toBe(true);
        expect(apkGateNeedsCheck(cache(), {origin: "https://other.example", now: 1_000_000})).toBe(true);
        expect(apkGateNeedsCheck(cache({latestCode: 11}), {origin: ORIGIN, now: 1_000_000})).toBe(true);
        expect(apkGateNeedsCheck(null, {origin: ORIGIN, now: 1_000_000})).toBe(true);
        expect(apkGateNeedsCheck(cache(), {origin: "", now: 1_000_000})).toBe(true);
    });
});

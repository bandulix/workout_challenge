import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, test} from "vitest";
import {duelDayLabel} from "../components/designBits";
import {accentInk} from "../components/gameBits";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");

function varsIn(selector) {
    const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
    const vars = {};
    for (const line of (match?.[1] || "").split(";")) {
        const found = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/.exec(line);
        if (found) vars[found[1]] = found[2].toLowerCase();
    }
    return vars;
}

function linear(value) {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * linear((n >> 16) & 255)
        + 0.7152 * linear((n >> 8) & 255)
        + 0.0722 * linear(n & 255);
}

function ratio(fg, bg) {
    const left = luminance(fg);
    const right = luminance(bg);
    return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function mix(fg, bg, alpha) {
    const fn = parseInt(fg.slice(1), 16);
    const bn = parseInt(bg.slice(1), 16);
    const channel = (shift) => Math.round(((fn >> shift) & 255) * alpha + ((bn >> shift) & 255) * (1 - alpha));
    return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}

const dark = varsIn(":root");
const light = {...dark, ...varsIn("html\\.light")};

describe("on-background text tokens", () => {
    const pairs = [
        ["text", "canvas"],
        ["text", "surface-1"],
        ["text-muted", "canvas"],
        ["text-muted", "surface-1"],
        ["volt-ink", "canvas"],
        ["volt-ink", "surface-1"],
        ["good-ink", "canvas"],
        ["good-ink", "surface-1"],
        ["mid-ink", "canvas"],
        ["mid-ink", "surface-1"],
        ["low-ink", "canvas"],
        ["low-ink", "surface-1"],
        ["other", "canvas"],
        ["other", "surface-1"],
    ];

    test.each(["dark", "light"])("%s theme clears WCAG AA", (theme) => {
        const tokens = theme === "dark" ? dark : light;
        for (const [fg, bg] of pairs) {
            expect(tokens[fg], `--${fg}`).toMatch(/^#[0-9a-f]{6}$/);
            expect(tokens[bg], `--${bg}`).toMatch(/^#[0-9a-f]{6}$/);
            expect(ratio(tokens[fg], tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    test("muted ink still clears AA on the 92% light veil over black", () => {
        const veil = mix(light.canvas, "#000000", 0.92);
        expect(ratio(light.text, veil)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(light["text-muted"], veil)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(light["volt-ink"], veil)).toBeGreaterThanOrEqual(4.5);
    });
});

describe("duel day labels", () => {
    const today = new Date(2026, 9, 24);

    test("names the weekday and marks today", () => {
        expect(duelDayLabel("2026-10-18", 0, today)).toBe("Day 1 · Sun 18");
        expect(duelDayLabel("2026-10-20", 1, today)).toBe("Day 2 · Tue 20");
        expect(duelDayLabel("2026-10-24", 6, today)).toBe("Today · Sat 24");
        expect(duelDayLabel("later", 0, today)).toBe("later");
    });
});

describe("accent ink", () => {
    test("keeps a dark accent and darkens volt", () => {
        expect(accentInk("#0b0b0c")).toBe("#0b0b0c");
        const ink = accentInk("#d7ff3e");
        expect(ratio(ink, "#f3f3f4")).toBeGreaterThanOrEqual(4.5);
        expect(ratio(ink, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    });
});

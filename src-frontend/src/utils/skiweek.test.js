import {describe, expect, it} from "vitest";
import {countdownParts, freshSnowCm, shareText, visiblePhase} from "./skiweek";
import {unitLabel, weatherName} from "./skiI18n";

const START = "2026-02-08T00:00:00+01:00";

function week(phase, extra = {}) {
    return {
        enabled: true,
        phase,
        starts_at: START,
        resort: {name: "Zermatt"},
        weather: {
            fresh_snow_cm: 12,
            current: {snow_valley_cm: 80, snow_summit_cm: 160},
        },
        ...extra,
    };
}

describe("ski week countdown", () => {
    it("counts days, hours, minutes and seconds until the start", () => {
        const now = new Date("2026-02-05T18:30:10+01:00");
        expect(countdownParts(START, now)).toEqual({
            remainingMs: (2 * 86400 + 5 * 3600 + 29 * 60 + 50) * 1000,
            kickedOff: false,
            days: 2,
            hours: 5,
            minutes: 29,
            seconds: 50,
        });
    });

    it("switches from pre-start to live the moment the clock hits zero", () => {
        const before = new Date("2026-02-07T23:59:59+01:00");
        const at = new Date("2026-02-08T00:00:00+01:00");
        expect(visiblePhase(week("prestart"), before)).toBe("prestart");
        expect(countdownParts(START, before).kickedOff).toBe(false);
        expect(visiblePhase(week("prestart"), at)).toBe("live");
        expect(countdownParts(START, at).kickedOff).toBe(true);
        expect(visiblePhase(week("ended"), at)).toBe("ended");
    });

    it("names fresh snow in one language and pluralises a single day", () => {
        expect(freshSnowCm(week("prestart").weather)).toBe("12");
        expect(unitLabel("en", 1, "day", "days")).toBe("Day");
        expect(unitLabel("en", 2, "day", "days")).toBe("Days");
        expect(unitLabel("de", 1, "day", "days")).toBe("Tag");
        expect(weatherName("en", 71)).toBe("Snow");
        expect(weatherName("de", 71)).toBe("Schnee");
        const text = shareText(week("prestart"), new Date("2026-02-07T12:00:00+01:00"));
        expect(text).toContain("days");
        expect(text).toContain("12 cm fresh snow");
        expect(text.toLowerCase()).not.toContain("drink");
        expect(text).not.toContain("Neuschnee");
    });
});

// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import SkiWeekHome from "./SkiWeekHome";

afterEach(cleanup);

vi.mock("./PersonaAvatar", () => ({default: () => <span data-testid="coach-avatar"/>}));
vi.mock("./ProfileAvatar", () => ({default: () => <span data-testid="crew-avatar"/>}));
vi.mock("../utils/toasts", () => ({toast: {success: vi.fn(), error: vi.fn()}}));

const BEFORE = new Date("2026-02-06T12:00:00+01:00");
const AT = new Date("2026-02-08T00:00:00+01:00");

function skiweek() {
    return {
        enabled: true,
        phase: "prestart",
        starts_at: "2026-02-08T00:00:00+01:00",
        resort: {name: "Zermatt"},
        weather: {
            available: true,
            is_snowing: true,
            mood: "snowing",
            fresh_snow_cm: 12,
            snowfall_24h_cm: 12,
            snowfall_72h_cm: 28,
            attribution: "Weather and snow: Open-Meteo.com",
            current: {
                label: "Snow",
                temperature_c: -4,
                snow_valley_cm: 80,
                snow_summit_cm: 160,
                freezing_level_m: 1480,
            },
            opening_days: [
                {date: "2026-02-08", label: "Snow", snowfall_cm: 6},
            ],
            opening_forecast_ready: true,
        },
        coach_teaser: {
            body: "Zermatt has 12 cm of fresh snow. The mountain is waiting.",
            persona: {name: "Alpine Coach", avatar: "zen"},
            posted: true,
        },
    };
}

describe("SkiWeekHome countdown", () => {
    it("shows the ticking clock, snow report, coach, and crew before the start", () => {
        render(
            <SkiWeekHome
                skiweek={skiweek()}
                participants={[{id: 1, username: "Lena"}, {id: 2, username: "Mats"}]}
                now={BEFORE}
            />,
        );
        expect(screen.getByRole("timer").textContent).toContain("1");
        expect(screen.getByText("Zermatt")).toBeTruthy();
        expect(screen.getByText("12 cm Neuschnee")).toBeTruthy();
        expect(screen.getByText("80")).toBeTruthy();
        expect(screen.getByText("160")).toBeTruthy();
        expect(screen.getByText(/freezing level 1480 m/)).toBeTruthy();
        expect(screen.getByText("Alpine Coach")).toBeTruthy();
        expect(screen.getByTestId("coach-avatar")).toBeTruthy();
        expect(screen.getByText(/fresh snow/)).toBeTruthy();
        expect(screen.getByText("Lena")).toBeTruthy();
        expect(screen.getByRole("button", {name: /Share/})).toBeTruthy();
        expect(screen.getByText("Weather and snow: Open-Meteo.com")).toBeTruthy();
    });

    it("opens the piste when the countdown reaches zero", () => {
        const {rerender} = render(<SkiWeekHome skiweek={skiweek()} now={BEFORE}/>);
        expect(screen.getByRole("timer")).toBeTruthy();
        rerender(<SkiWeekHome skiweek={skiweek()} now={AT}/>);
        expect(screen.getByText("Piste offen")).toBeTruthy();
        expect(screen.queryByRole("timer")).toBeNull();
    });

    it("repeats a short teaser on the feed", () => {
        render(<SkiWeekHome skiweek={skiweek()} variant="teaser" now={BEFORE}/>);
        expect(screen.getByText(/1d /)).toBeTruthy();
        expect(screen.getByText("Alpine Coach")).toBeTruthy();
        expect(screen.getByTestId("coach-avatar")).toBeTruthy();
    });
});

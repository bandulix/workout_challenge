// @vitest-environment jsdom
import React from "react";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
import {HomeOrderCard, HomePulse} from "./polishBits";
import {OrderCard} from "./gameBits";
import {ReadinessSheet} from "./ReadinessBits";
import {orderForHome} from "../utils/readinessTheme";

afterEach(cleanup);

const readiness = {
    score: 86,
    band: "green",
    why: "HRV 20% above your norm, 8h sleep",
    disclaimer: "A training hint from your recent numbers, not medical advice.",
    timezone: "Europe/London",
    warming_up: false,
    consent: {text: "Daily summaries only.", opted_in: true, scopes: ["sleep"], available_scopes: []},
    preference: {morning_push_enabled: false, quiet_start_minute: 1320, quiet_end_minute: 420},
    trend: [
        {date: "2026-10-18", hrv_ms: 60, resting_hr: 52, sleep_minutes: 450, load: 20},
        {date: "2026-10-24", hrv_ms: 72, resting_hr: 48, sleep_minutes: 480, load: 30},
    ],
    checkin: null,
};

describe("readiness home", () => {
    it("puts a private chip on the week card and colours the order", () => {
        const open = vi.fn();
        render(
            <MemoryRouter>
                <HomePulse minutes={40} streak={3} activeDays={3} rank={2} readiness={readiness} onOpenReadiness={open}/>
                <HomeOrderCard order={{
                    brief: "Push day. Stretch goal: 48 minutes.",
                    why: readiness.why,
                    band: "green",
                    disclaimer: readiness.disclaimer,
                    competition_name: "WHO",
                }}/>
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole("button", {name: /green/i}));
        expect(open).toHaveBeenCalled();
        expect(screen.getAllByText(readiness.why).length).toBeGreaterThan(0);
        expect(screen.getByText(readiness.disclaimer)).toBeInTheDocument();
        expect(screen.getByText(/Push day/)).toBeInTheDocument();
    });

    it("keeps a personal order ahead of the group order", () => {
        const personal = {competition_id: 4, brief: "Recovery day. Protect the streak.", band: "red"};
        const group = {brief: "All out.", competition_id: 4};
        expect(orderForHome(group, {orders: [personal], order: personal}, 4).band).toBe("red");
        expect(orderForHome(group, {orders: []}, 4).brief).toBe("All out.");
    });

    it("shows the check-in and says the number is private", () => {
        render(
            <ReadinessSheet
                payload={{...readiness, band: "red", score: 32, why: "HRV 44% below your norm, 4h40 sleep"}}
                onClose={vi.fn()}
                onCheckIn={vi.fn()}
                onSavePrefs={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        expect(screen.getByText(/Only you see this/)).toBeInTheDocument();
        expect(screen.getByText("How do you feel?")).toBeInTheDocument();
        expect(screen.getAllByRole("button", {name: "1"}).length).toBeGreaterThan(0);
        expect(screen.getByText(/HRV 44% below your norm/)).toBeInTheDocument();
    });

    it("paints a red order edge on the coach card", () => {
        const {container} = render(
            <OrderCard order={{
                brief: "Recovery day. Protect the streak.",
                why: "HRV 44% below your norm",
                band: "red",
                date: "2026-10-24",
                completed: false,
                disclaimer: readiness.disclaimer,
            }}/>,
        );
        const article = container.querySelector("article");
        expect(article.style.borderLeftColor.replace(/\s/g, "")).toMatch(/e24b4b|226,75,75/i);
        expect(screen.getByText(/Protect the streak/)).toBeInTheDocument();
    });
});

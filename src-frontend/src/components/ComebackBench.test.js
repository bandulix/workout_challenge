// @vitest-environment jsdom
import React from "react";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const {getBench, updateBench, createOffer, respondOffer} = vi.hoisted(() => ({
    getBench: vi.fn(),
    updateBench: vi.fn(),
    createOffer: vi.fn(),
    respondOffer: vi.fn(),
}));
vi.mock("../utils/reducers/drillInstructorSlice", () => ({
    useGetComebackBenchQuery: getBench,
    useUpdateComebackBenchMutation: updateBench,
    useCreateComebackSupportOfferMutation: createOffer,
    useRespondToComebackSupportOfferMutation: respondOffer,
}));

import ComebackBench, {ComebackPreferences} from "./ComebackBench";

const bench = {
    current_period: {workout_count: 1},
    previous_period: {workout_count: 3},
    prompt_visible: true,
    return_action: "If it feels right, log any comfortable activity. Rest is valid too.",
    preferences: {prompts_enabled: true, dismissed_until: null, support_opt_in: false},
};

describe("ComebackBench", () => {
    const patch = vi.fn();

    beforeEach(() => {
        getBench.mockReturnValue({data: bench, isLoading: false});
        updateBench.mockReturnValue([patch, {isLoading: false}]);
        createOffer.mockReturnValue([vi.fn(), {isLoading: false}]);
        respondOffer.mockReturnValue([vi.fn(), {isLoading: false}]);
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it("shows the private pace note with a one-week dismissal and no log button", () => {
        render(<ComebackBench/>);

        expect(screen.getByText(/this week: 1 activity/i)).toBeTruthy();
        expect(screen.getByText(/last week: 3 activities/i)).toBeTruthy();
        expect(screen.queryByRole("button", {name: /log an activity/i})).toBeNull();
        expect(screen.queryByText(/comeback preferences/i)).toBeNull();
        fireEvent.click(screen.getByRole("button", {name: /dismiss for a week/i}));
        expect(patch).toHaveBeenCalledWith({dismiss_for_days: 7});
    });

    it("renders nothing on home when there is no prompt and no offers", () => {
        getBench.mockReturnValue({data: {...bench, prompt_visible: false}, isLoading: false});
        const {container} = render(<ComebackBench/>);
        expect(container.innerHTML).toBe("");
    });

    it("lets the user mute prompts and control support opt-in from settings", () => {
        render(<ComebackPreferences/>);
        fireEvent.click(screen.getByRole("button", {name: /mute prompts/i}));
        expect(patch).toHaveBeenCalledWith({prompts_enabled: false});
        fireEvent.click(screen.getByRole("checkbox", {name: /open to a nudge/i}));
        expect(screen.getByText(/first name only/i)).toBeTruthy();
        expect(patch).toHaveBeenCalledWith({support_opt_in: true});
    });

    it("lets a recipient accept or decline each private support offer", () => {
        const respond = vi.fn();
        respondOffer.mockReturnValue([respond, {isLoading: false}]);
        getBench.mockReturnValue({data: {
            ...bench,
            incoming_offers: [{id: 12, sender_first_name: "Ari", competition_name: "Trail Cup", offer_kind: "cheer"}],
        }, isLoading: false});
        render(<ComebackBench/>);

        fireEvent.click(screen.getByRole("button", {name: /accept support offer from ari/i}));
        expect(respond).toHaveBeenCalledWith({offerId: 12, accepted: true});
        fireEvent.click(screen.getByRole("button", {name: /decline support offer from ari/i}));
        expect(respond).toHaveBeenCalledWith({offerId: 12, accepted: false});
    });

    it("lets an opted-in teammate offer support without exposing activity status", () => {
        const create = vi.fn();
        createOffer.mockReturnValue([create, {isLoading: false}]);
        getBench.mockReturnValue({data: {
            ...bench,
            preferences: {...bench.preferences, support_opt_in: true},
            support_peers: [{id: 22, first_name: "Ari", competition_id: 3, competition_name: "Trail Cup"}],
            incoming_offers: [],
            outgoing_offers: [],
        }, isLoading: false});
        render(<ComebackPreferences/>);

        fireEvent.change(screen.getByRole("combobox", {name: "Teammate"}), {target: {value: "22:3"}});
        fireEvent.click(screen.getByRole("button", {name: /offer support/i}));
        expect(create).toHaveBeenCalledWith({recipient_id: 22, competition_id: 3, offer_kind: "cheer"});
    });
});

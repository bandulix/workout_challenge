// @vitest-environment jsdom
import React from "react";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Provider} from "react-redux";
import {ActivityCoachPost, activityPictures} from "./competitionChrome";
import store from "../utils/store";

vi.mock("../utils/protectedMedia", () => ({
    useProtectedImage: (url) => ({src: url || null, failed: !url}),
}));

function stubMatchMedia() {
    window.matchMedia = (query) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    });
}

const posted = "2026-10-25T08:00:00Z";

function activityMessage() {
    return {
        id: 9,
        kind: "activity",
        body: "That run looked honest. The hill did not clap.",
        athlete_name: "Charlotte",
        workout_user_id: 4,
        workout_summary: "52 min Run",
        points_capped: 18,
        points_raw: 18,
        posted_at: posted,
        replies: [
            {
                id: 21,
                kind: "photo",
                is_coach: false,
                image: "/api/drill-instructor/message/21/picture/",
                body: "The hill, before the coach got to it.",
                posted_at: posted,
                author_name: "Charlotte",
            },
            {
                id: 22,
                kind: "reaction",
                is_coach: true,
                image: "/api/drill-instructor/message/22/picture/",
                body: "Posted it. The coach redrew the hill steeper.",
                posted_at: posted,
            },
        ],
        reacts: [],
    };
}

function renderPost(message = activityMessage()) {
    return render(
        <Provider store={store}>
            <ActivityCoachPost
                message={message}
                persona={{name: "Drill Sergeant", avatar: "sergeant", theme_color: "#d7ff3e"}}
                meId={4}
                canReply={false}
                competitionId={3}
            />
        </Provider>,
    );
}

describe("activity coach post", () => {
    beforeEach(() => {
        stubMatchMedia();
    });

    afterEach(() => {
        cleanup();
    });

    it("shows the coach reaction and both the upload and the coach edit", () => {
        renderPost();
        expect(screen.getByText("That run looked honest. The hill did not clap.")).toBeTruthy();
        expect(screen.getByRole("img", {name: "Upload from Charlotte"})).toBeTruthy();
        expect(screen.getByRole("img", {name: "Coach edit of Charlotte's Run"})).toBeTruthy();
        expect(screen.getByText("Posted it. The coach redrew the hill steeper.")).toBeTruthy();
        expect(activityPictures(activityMessage())).toMatchObject({
            upload: "/api/drill-instructor/message/21/picture/",
            edit: "/api/drill-instructor/message/22/picture/",
        });
    });

    it("opens the activity detail with the same coach reaction", () => {
        renderPost();
        fireEvent.click(screen.getByRole("button", {name: "Activity detail for Charlotte's Run"}));
        expect(screen.getByRole("dialog", {name: "Charlotte · Run"})).toBeTruthy();
        expect(screen.getAllByText("That run looked honest. The hill did not clap.").length).toBeGreaterThan(1);
    });

    it("still shows a coach reaction when the activity has no photo", () => {
        const message = activityMessage();
        message.replies = [];
        renderPost(message);
        expect(screen.getByText("That run looked honest. The hill did not clap.")).toBeTruthy();
        expect(screen.queryByRole("img", {name: /Coach edit/i})).toBeNull();
    });
});

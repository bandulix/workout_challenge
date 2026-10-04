// @vitest-environment jsdom
import React from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
    echoes: [],
    dispatch: vi.fn(),
    removeEcho: vi.fn(),
}));

vi.mock("react-redux", () => ({useDispatch: () => mocks.dispatch}));
vi.mock("../utils/reducers/drillInstructorSlice", () => ({
    useDeleteEchoMutation: () => [mocks.removeEcho, {isLoading: false}],
    useGetEchoesQuery: () => ({data: mocks.echoes}),
}));
vi.mock("../utils/protectedMedia", () => ({useProtectedImage: () => ({src: null})}));
vi.mock("../utils/usePollingInterval", () => ({default: () => 90000}));
vi.mock("../utils/sfx", () => ({
    echoSfxItems: () => [],
    useSfxObserver: vi.fn(),
}));
vi.mock("../utils/dialogs", () => ({confirmAction: vi.fn()}));
vi.mock("../utils/toasts", () => ({toast: {error: vi.fn()}}));
vi.mock("../utils/shareCard", () => ({sharePostCard: vi.fn()}));
vi.mock("../utils/reducers/usersSlice", () => ({usersApi: {util: {invalidateTags: vi.fn()}}}));
vi.mock("../utils/reducers/statsSlice", () => ({statsApi: {util: {invalidateTags: vi.fn()}}}));
vi.mock("./uiBits", () => ({
    PaneHead: ({title, hint, children}) => <header><h2>{title}</h2><p>{hint}</p>{children}</header>,
}));
vi.mock("../forms/basicComponents", () => ({
    Modal: ({title, children}) => <section role="dialog"><h2>{title}</h2>{children}</section>,
}));
vi.mock("./gameBits", () => ({RoastGallery: () => null}));

import EchoLiveStrip from "./EchoLiveStrip";

const oldEcho = {
    id: 1,
    title: "Mira's Cycling Echo",
    narrative: "A steady ride",
    status: "undefeated",
    created_at: "2026-09-01T00:00:00.000Z",
    last_claimed_at: null,
    metric_label: "14 km Cycling",
    holder_name: "Mira",
    power: 31,
    defenses: 0,
    image: null,
    can_delete: false,
};

const newEcho = {...oldEcho, id: 2, title: "Mira's New Run Echo", created_at: new Date().toISOString()};

describe("EchoLiveStrip", () => {
    afterEach(cleanup);

    beforeEach(() => {
        mocks.echoes = [];
        mocks.dispatch.mockClear();
    });

    it("keeps the archive reachable without showing quiet relics in the live surface", () => {
        mocks.echoes = [oldEcho];
        render(<EchoLiveStrip competitionId={3} userId={5}/>);
        expect(screen.queryByText("Live Echoes")).not.toBeInTheDocument();
        expect(screen.getByRole("button", {name: /echo archive/i})).toBeInTheDocument();
        expect(screen.queryByText(oldEcho.title)).not.toBeInTheDocument();
    });

    it("surfaces a newly planted relic and leaves full history one tap away", () => {
        mocks.echoes = [newEcho, oldEcho];
        render(<EchoLiveStrip competitionId={3} userId={5}/>);
        expect(screen.getByText("Echo updates")).toBeInTheDocument();
        expect(screen.getByText(newEcho.title)).toBeInTheDocument();
        expect(screen.getByRole("button", {name: /echo archive · 2/i})).toBeInTheDocument();
    });

    it("opens the full Echo archive from the quiet-state link", () => {
        mocks.echoes = [oldEcho];
        render(<EchoLiveStrip competitionId={3} userId={5}/>);
        fireEvent.click(screen.getByRole("button", {name: /echo archive/i}));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText(oldEcho.title)).toBeInTheDocument();
    });

    it("renders nothing before the challenge has any Echo history", () => {
        const {container} = render(<EchoLiveStrip competitionId={3} userId={5}/>);
        expect(container.firstChild).toBeNull();
    });

    it("parks the quiet archive pill in the header row with Goals", () => {
        mocks.echoes = [oldEcho];
        const host = document.createElement("div");
        document.body.appendChild(host);
        render(<EchoLiveStrip competitionId={3} userId={5} archiveHost={host}/>);
        const button = screen.getByRole("button", {name: /echo archive · 1/i});
        expect(host.contains(button)).toBe(true);
        host.remove();
    });

    it("keeps a live archive pill in the header slot instead of the updates pane", () => {
        mocks.echoes = [newEcho, oldEcho];
        const host = document.createElement("div");
        document.body.appendChild(host);
        render(<EchoLiveStrip competitionId={3} userId={5} archiveHost={host}/>);
        const button = screen.getByRole("button", {name: /echo archive · 2/i});
        expect(host.contains(button)).toBe(true);
        expect(screen.getByText("Echo updates")).toBeInTheDocument();
        host.remove();
    });
});

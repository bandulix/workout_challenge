import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("./platform", () => ({
    assetUrl: (path) => `https://challenge.example.com${path}`,
    isNativeApp: vi.fn(() => false),
}));

vi.mock("./authTokens", () => ({
    ensureFreshAccessToken: vi.fn(async () => "ok"),
    getAccessToken: vi.fn(() => "access-token"),
    refreshAccessToken: vi.fn(async () => "ok"),
}));

vi.mock("js-synthesizer", () => {
    const api = {
        playPlayer: vi.fn(async () => {}),
        stopPlayer: vi.fn(),
        isPlayerPlaying: vi.fn(() => false),
        waitForReady: async () => {},
    };
    api.Synthesizer = class {
        init() {}
        createAudioNode() { return {connect() {}}; }
        async loadSFont() {}
        setGain() {}
        isPlayerPlaying() { return api.isPlayerPlaying(); }
        stopPlayer() { return api.stopPlayer(); }
        async waitForPlayerStopped() {}
        async resetPlayer() {}
        async addSMFDataToPlayer() {}
        setPlayerLoop() {}
        playPlayer() { return api.playPlayer(); }
    };
    return api;
});

import * as synthApi from "js-synthesizer";
import {ensureFreshAccessToken, getAccessToken, refreshAccessToken} from "./authTokens";
import {isNativeApp} from "./platform";
import {_resetMidiBedForTests, startMidiBed, stopMidiBed} from "./midiBed";
import {_resetSfxForTests, setSfxEnabled} from "./sfx";

const MIDI_PATH = "/api/drill-instructor/config/1/midi/";
const MIDI_BYTES = new Uint8Array(20).buffer;

function stubWindow() {
    const w = {
        Module: {_new_fluid_synth: true},
        AudioContext: class {
            constructor() {
                this.state = "running";
                this.sampleRate = 44100;
                this.destination = {};
            }
            resume() { return Promise.resolve(); }
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        setTimeout,
        clearTimeout,
    };
    vi.stubGlobal("window", w);
    return w;
}

function midiOk() {
    return {ok: true, status: 200, arrayBuffer: async () => MIDI_BYTES};
}

function fontOk() {
    return {ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8)};
}

describe("startMidiBed", () => {
    let fetchMock;

    beforeEach(() => {
        _resetMidiBedForTests();
        _resetSfxForTests();
        setSfxEnabled(true);
        stubWindow();
        fetchMock = vi.fn(async (url) => (
            String(url).includes("/midi") ? midiOk() : fontOk()
        ));
        vi.stubGlobal("fetch", fetchMock);
        ensureFreshAccessToken.mockClear();
        refreshAccessToken.mockClear();
        getAccessToken.mockClear();
        getAccessToken.mockReturnValue("access-token");
        refreshAccessToken.mockResolvedValue("ok");
        isNativeApp.mockReturnValue(false);
        synthApi.playPlayer.mockClear();
        synthApi.stopPlayer.mockClear();
        synthApi.isPlayerPlaying.mockReturnValue(false);
    });

    afterEach(() => {
        _resetMidiBedForTests();
        _resetSfxForTests();
        vi.unstubAllGlobals();
    });

    async function parkMidiFetch() {
        let release;
        fetchMock.mockImplementation((url) => {
            if (String(url).includes("/midi")) {
                return new Promise((resolve) => {
                    release = () => resolve(midiOk());
                });
            }
            return Promise.resolve(fontOk());
        });
        const pending = startMidiBed(MIDI_PATH);
        await vi.waitFor(() => {
            if (typeof release !== "function") throw new Error("MIDI fetch not started");
        });
        return {pending, release};
    }

    it("does not play after stop during the MIDI fetch", async () => {
        const {pending, release} = await parkMidiFetch();
        await stopMidiBed();
        release();
        await pending;
        expect(synthApi.playPlayer).not.toHaveBeenCalled();
    });

    it("does not play if sound is muted while the MIDI fetch is in flight", async () => {
        const {pending, release} = await parkMidiFetch();
        setSfxEnabled(false);
        release();
        await pending;
        expect(synthApi.playPlayer).not.toHaveBeenCalled();
    });

    it("refreshes a stale JWT and retries once on 401", async () => {
        getAccessToken
            .mockReturnValueOnce("old-token")
            .mockReturnValue("new-token");
        refreshAccessToken.mockImplementation(async () => {
            getAccessToken.mockReturnValue("new-token");
            return "ok";
        });
        fetchMock.mockImplementation(async (url, opts) => {
            if (!String(url).includes("/midi")) return fontOk();
            const auth = opts?.headers?.Authorization;
            if (auth === "Bearer old-token") {
                return {ok: false, status: 401};
            }
            expect(auth).toBe("Bearer new-token");
            return midiOk();
        });
        await startMidiBed(MIDI_PATH);
        expect(ensureFreshAccessToken).toHaveBeenCalled();
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(synthApi.playPlayer).toHaveBeenCalled();
    });

    it("loads the bundled soundfont even on native, not the API host", async () => {
        isNativeApp.mockReturnValue(true);
        await startMidiBed(MIDI_PATH);
        const fontUrls = fetchMock.mock.calls
            .map(([url]) => String(url))
            .filter((url) => url.includes("soundfonts"));
        expect(fontUrls).toEqual(["/soundfonts/GeneralUser-GS.sf2"]);
        expect(synthApi.playPlayer).toHaveBeenCalled();
    });
});

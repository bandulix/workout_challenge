import {afterEach, describe, expect, it, vi} from "vitest";
import {
    _resetSfxForTests,
    echoSfxItems,
    feedSfxItems,
    hallSfxItems,
    installSfxUnlock,
    observeSfx,
    playSfx,
    setSfxEnabled,
    sfxEnabled,
    sfxOnce,
} from "./sfx";

afterEach(() => {
    _resetSfxForTests();
    vi.unstubAllGlobals();
});

describe("sfxEnabled", () => {
    it("defaults on", () => {
        expect(sfxEnabled()).toBe(true);
    });

    it("remembers the toggle", () => {
        setSfxEnabled(true);
        expect(sfxEnabled()).toBe(true);
        setSfxEnabled(false);
        expect(sfxEnabled()).toBe(false);
    });
});

describe("playSfx", () => {
    it("is a no-op while muted", () => {
        const vibrate = vi.fn();
        vi.stubGlobal("navigator", {vibrate});
        setSfxEnabled(false);
        playSfx("stamp");
        expect(vibrate).not.toHaveBeenCalled();
    });

    it("buzzes when sound is on", () => {
        const vibrate = vi.fn();
        vi.stubGlobal("navigator", {vibrate});
        setSfxEnabled(true);
        playSfx("vote");
        expect(vibrate).toHaveBeenCalled();
    });
});

describe("observeSfx", () => {
    it("primes existing keys then plays only arrivals", () => {
        const vibrate = vi.fn();
        vi.stubGlobal("navigator", {vibrate});
        setSfxEnabled(true);
        observeSfx("feed", [{key: "roast:1", sound: "roast_reveal"}]);
        expect(vibrate).not.toHaveBeenCalled();
        observeSfx("feed", [
            {key: "roast:1", sound: "roast_reveal"},
            {key: "roast:2", sound: "roast_reveal"},
        ]);
        expect(vibrate).toHaveBeenCalledTimes(1);
        observeSfx("feed", [
            {key: "roast:1", sound: "roast_reveal"},
            {key: "roast:2", sound: "roast_reveal"},
        ]);
        expect(vibrate).toHaveBeenCalledTimes(1);
    });

    it("sfxOnce does not replay the same key", () => {
        const vibrate = vi.fn();
        vi.stubGlobal("navigator", {vibrate});
        setSfxEnabled(true);
        expect(sfxOnce("echo-war:9", "echo_war")).toBe(true);
        expect(sfxOnce("echo-war:9", "echo_war")).toBe(false);
        expect(vibrate).toHaveBeenCalledTimes(1);
    });
});

describe("installSfxUnlock", () => {
    function stubWindow() {
        const listeners = {};
        const store = {};
        const windowMock = {
            addEventListener(type, fn) {
                (listeners[type] ||= []).push(fn);
            },
            removeEventListener(type, fn) {
                listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
            },
            dispatchEvent() {},
            localStorage: {
                getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
                setItem: (key, value) => { store[key] = String(value); },
                removeItem: (key) => { delete store[key]; },
            },
        };
        vi.stubGlobal("window", windowMock);
        vi.stubGlobal("Audio", vi.fn(function Audio() {
            this.volume = 1;
            this.preload = "";
            this.src = "";
            this.play = vi.fn(() => Promise.resolve());
            this.pause = vi.fn();
            this.currentTime = 0;
        }));
        return listeners;
    }

    function fire(listeners, type) {
        for (const fn of [...(listeners[type] || [])]) fn();
    }

    it("unlocks once then drops the gesture listeners", () => {
        const listeners = stubWindow();
        installSfxUnlock();
        expect(listeners.pointerdown).toHaveLength(1);
        fire(listeners, "pointerdown");
        const afterFirst = Audio.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);
        expect(listeners.pointerdown).toHaveLength(0);
        expect(listeners.keydown).toHaveLength(0);
        fire(listeners, "pointerdown");
        fire(listeners, "keydown");
        expect(Audio.mock.calls.length).toBe(afterFirst);
    });

    it("keeps listening when the first gesture happens while muted", () => {
        const listeners = stubWindow();
        setSfxEnabled(false);
        installSfxUnlock();
        fire(listeners, "pointerdown");
        expect(Audio).not.toHaveBeenCalled();
        expect(listeners.pointerdown).toHaveLength(1);
        setSfxEnabled(true);
        fire(listeners, "pointerdown");
        expect(Audio).toHaveBeenCalled();
        expect(listeners.pointerdown).toHaveLength(0);
    });
});

describe("item mappers", () => {
    it("maps remix replies from the feed and leaves echo stings to the chamber", () => {
        const items = feedSfxItems([
            {id: 1, kind: "activity", replies: [{id: 11, is_coach: true, image: "/x.jpg"}]},
            {id: 2, kind: "echo"},
            {id: 3, kind: "claim"},
            {id: 4, kind: "war"},
        ]);
        expect(items).toEqual([
            {key: "roast:11", sound: "roast_reveal"},
        ]);
    });

    it("maps hall cards onto the same roast keys", () => {
        expect(hallSfxItems([{id: 11, image: "/x.jpg"}])).toEqual([
            {key: "roast:11", sound: "roast_reveal"},
        ]);
    });

    it("maps planted, claimed, and war echoes", () => {
        const items = echoSfxItems([
            {id: 8, origin_id: 1, holder_id: 2},
            {id: 9, origin_id: 1, holder_id: 3, active_challenge: {id: 1}},
        ], 3);
        expect(items).toEqual([
            {key: "echo:8", sound: "echo_plant"},
            {key: "echo:9", sound: "echo_plant"},
            {key: "echo-claim:9:3", sound: "echo_claim"},
            {key: "echo-war:9", sound: "echo_war"},
        ]);
    });
});

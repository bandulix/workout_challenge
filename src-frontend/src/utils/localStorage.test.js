// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {clearPersistedState, loadState, PERSIST_VERSION, saveState} from "./localStorage";

describe("persisted app state", () => {
    const storage = new Map();
    const localStorageMock = {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    };

    beforeEach(() => {
        storage.clear();
        Object.defineProperty(window, "localStorage", {configurable: true, value: localStorageMock});
    });
    afterEach(() => storage.clear());

    it("strips challenge join codes and credentials before writing", () => {
        const state = {
            competitionsApi: {
                queries: {
                    'getCompetitions(undefined)': {
                        status: "fulfilled",
                        data: [{id: 4, name: "Autumn", join_code: "SECRET42", owner: {email: "a@b.c", password: "x"}}],
                    },
                },
            },
        };
        expect(saveState(state)).toBe(true);
        const raw = localStorage.getItem("appState");
        expect(raw).not.toContain("SECRET42");
        expect(raw).not.toContain('"password"');
        const restored = loadState();
        const competition = restored.competitionsApi.queries['getCompetitions(undefined)'].data[0];
        expect(competition.name).toBe("Autumn");
        expect(competition).not.toHaveProperty("join_code");
        expect(competition.owner).not.toHaveProperty("password");
    });

    it("drops the whole blob when the session is over", () => {
        saveState({usersApi: {queries: {}}});
        expect(localStorage.getItem("appState")).toContain(`"_v":${PERSIST_VERSION}`);
        clearPersistedState();
        expect(localStorage.getItem("appState")).toBeNull();
        expect(loadState()).toBeUndefined();
    });
});

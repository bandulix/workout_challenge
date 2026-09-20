import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {toast} from "./toasts";

// Test env is node - give the module a minimal window to dispatch on.
if (typeof globalThis.CustomEvent !== "function") {
    globalThis.CustomEvent = class CustomEvent extends Event {
        constructor(type, params = {}) {
            super(type, params);
            this.detail = params.detail ?? null;
        }
    };
}

describe("toast", () => {
    let events;
    let listener;

    beforeEach(() => {
        vi.stubGlobal("window", new EventTarget());
        events = [];
        listener = (e) => events.push(e.detail);
        window.addEventListener("wc-toast", listener);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("dispatches a wc-toast event with defaults", () => {
        toast("Saved.");
        expect(events).toHaveLength(1);
        expect(events[0].message).toBe("Saved.");
        expect(events[0].kind).toBe("info");
        expect(events[0].duration).toBe(4500);
        expect(events[0].id).toBeTruthy();
    });

    it("error toasts stay longer", () => {
        toast.error("Broke.");
        expect(events[0].kind).toBe("error");
        expect(events[0].duration).toBe(6500);
    });

    it("success shortcut sets the kind", () => {
        toast.success("Done.");
        expect(events[0].kind).toBe("success");
        expect(events[0].duration).toBe(4500);
    });

    it("ignores empty messages", () => {
        toast("");
        toast(null);
        toast("   ");
        expect(events).toHaveLength(0);
    });

    it("respects an explicit duration", () => {
        toast("Quick", {duration: 1000});
        expect(events[0].duration).toBe(1000);
    });
});

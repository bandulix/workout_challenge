import {useEffect, useRef, useState} from "react";
import {isNativeApp} from "./serverUrl";

// Short in-app stings from Kenney Interface Sounds (CC0). On by default;
// mute on Coach or in Account settings. Unlock on a real tap.
const STORAGE = "wc-sfx";
const EVENT = "wc-sfx";
const DEBOUNCE_MS = 400;

const FILES = {
    stamp: "/sfx/stamp.mp3",
    roast_hot: "/sfx/roast_hot.mp3",
    roast_nope: "/sfx/roast_nope.mp3",
    echo_plant: "/sfx/echo_plant.mp3",
    echo_claim: "/sfx/echo_claim.mp3",
    echo_war: "/sfx/echo_war.mp3",
    vote: "/sfx/vote.mp3",
    roast_reveal: "/sfx/roast_reveal.mp3",
    ring_full: "/sfx/ring_full.mp3",
};

let memory = null;
let sfxSessionUnlocked = false;
const seenKeys = new Set();
const primedScopes = new Set();
const lastPlayed = new Map();

function storeGet() {
    try {
        const stored = window.localStorage.getItem(STORAGE);
        if (stored === "on" || stored === "off") return stored;
    } catch {
        /* private mode / node tests */
    }
    return memory;
}

function storeSet(value) {
    memory = value;
    try {
        window.localStorage.setItem(STORAGE, value);
    } catch {
        /* private mode / node tests */
    }
}

export function sfxEnabled() {
    const value = storeGet();
    if (value === "off") return false;
    if (value === "on") return true;
    // Web can start noisy; phones in a bag should not.
    return !isNativeApp();
}

export function setSfxEnabled(on) {
    storeSet(on ? "on" : "off");
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(EVENT));
    }
    if (on) {
        unlockSfx();
        preloadSfx();
    }
}

export function useSfxEnabled() {
    const [on, setOn] = useState(() => sfxEnabled());
    useEffect(() => {
        const sync = () => setOn(sfxEnabled());
        sync();
        window.addEventListener(EVENT, sync);
        return () => window.removeEventListener(EVENT, sync);
    }, []);
    return [on, setSfxEnabled];
}

function canPlayFiles() {
    return typeof Audio !== "undefined";
}

export function unlockSfx() {
    if (!canPlayFiles()) return;
    try {
        const a = new Audio(FILES.vote);
        a.volume = 0;
        const p = a.play();
        if (p && typeof p.then === "function") {
            p.then(() => {
                a.pause();
                a.currentTime = 0;
            }).catch(() => {});
        }
    } catch {
        /* autoplay still locked */
    }
}

function preloadSfx() {
    if (!canPlayFiles()) return;
    Object.values(FILES).forEach((src) => {
        try {
            const a = new Audio();
            a.preload = "auto";
            a.src = src;
        } catch {
            /* ignore */
        }
    });
}

export function installSfxUnlock() {
    if (typeof window === "undefined") return () => {};
    if (sfxSessionUnlocked) return () => {};
    const go = () => {
        if (!sfxEnabled()) return;
        sfxSessionUnlocked = true;
        window.removeEventListener("pointerdown", go);
        window.removeEventListener("keydown", go);
        unlockSfx();
        preloadSfx();
    };
    window.addEventListener("pointerdown", go, {passive: true});
    window.addEventListener("keydown", go);
    return () => {
        window.removeEventListener("pointerdown", go);
        window.removeEventListener("keydown", go);
    };
}

function haptic(name) {
    const pattern = {
        stamp: [12],
        roast_hot: [18],
        roast_nope: [10, 30, 10],
        echo_plant: [20, 40, 20],
        echo_claim: [30, 20, 30],
        echo_war: [40, 40, 40],
        vote: [14],
        roast_reveal: [24],
        ring_full: [20, 40, 20, 40, 50],
    }[name];
    if (pattern) navigator.vibrate?.(pattern);
}

export function playSfx(name) {
    if (!sfxEnabled()) return;
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if ((lastPlayed.get(name) || 0) > now - DEBOUNCE_MS) return;
    lastPlayed.set(name, now);
    haptic(name);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wc-sfx-play"));
    }
    const src = FILES[name];
    if (!src || !canPlayFiles()) return;
    try {
        const a = new Audio(src);
        a.volume = 0.75;
        const p = a.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
        /* node tests / autoplay */
    }
}

export function sfxOnce(key, name) {
    if (!key) return false;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    playSfx(name);
    return true;
}

export function observeSfx(scope, items) {
    if (!scope) return;
    const list = items || [];
    if (!primedScopes.has(scope)) {
        list.forEach((item) => { if (item?.key) seenKeys.add(item.key); });
        primedScopes.add(scope);
        return;
    }
    for (const item of list) {
        if (!item?.key || seenKeys.has(item.key)) continue;
        seenKeys.add(item.key);
        playSfx(item.sound);
    }
}

export function useSfxObserver(scope, items, ready = true) {
    const primed = useRef(false);
    const itemsRef = useRef(items);
    itemsRef.current = items;
    const keyList = (items || []).map((i) => `${i.key}:${i.sound}`).join("|");
    useEffect(() => {
        if (!ready) return;
        const list = itemsRef.current || [];
        if (!primed.current) {
            list.forEach((item) => { if (item?.key) seenKeys.add(item.key); });
            primed.current = true;
            return;
        }
        for (const item of list) {
            if (!item?.key || seenKeys.has(item.key)) continue;
            seenKeys.add(item.key);
            playSfx(item.sound);
        }
    }, [scope, ready, keyList]);
}

export function feedSfxItems(messages) {
    const items = [];
    for (const m of messages || []) {
        // Echo plant/claim/war stings live in echoSfxItems so the
        // challenge page (feed + chamber both mounted) does not double-play.
        const remix = (m.replies || []).find((r) => r.is_coach && r.image);
        if (remix) items.push({key: `roast:${remix.id}`, sound: "roast_reveal"});
        for (const echo of m.echoes || []) {
            items.push({
                key: `echo:${echo.id}:${echo.role || "earned"}`,
                sound: echo.role === "claimed" ? "echo_claim" : "echo_plant",
            });
        }
    }
    return items;
}

export function hallSfxItems(cards) {
    return (cards || [])
        .filter((c) => c?.id && c.image)
        .map((c) => ({key: `roast:${c.id}`, sound: "roast_reveal"}));
}

export function echoSfxItems(echoes, userId) {
    const items = [];
    for (const echo of echoes || []) {
        items.push({key: `echo:${echo.id}`, sound: "echo_plant"});
        if (userId && echo.holder_id === userId && echo.origin_id !== userId) {
            items.push({key: `echo-claim:${echo.id}:${echo.holder_id}`, sound: "echo_claim"});
        }
        if (echo.active_challenge) {
            items.push({key: `echo-war:${echo.id}`, sound: "echo_war"});
        }
    }
    return items;
}

export function _resetSfxForTests() {
    memory = null;
    sfxSessionUnlocked = false;
    seenKeys.clear();
    primedScopes.clear();
    lastPlayed.clear();
    try {
        window.localStorage.removeItem(STORAGE);
    } catch {
        /* ignore */
    }
}

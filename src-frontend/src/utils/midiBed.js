import {useEffect, useState} from "react";
import {CapacitorHttp} from "@capacitor/core";
import {ensureFreshAccessToken, getAccessToken, refreshAccessToken} from "./authTokens";
import {assetUrl, isNativeApp} from "./platform";
import {sfxEnabled} from "./sfx";

const SOUNDFONT_PATH = "/soundfonts/GeneralUser-GS.sf2";
const FLUID_SRC = "/synth/libfluidsynth-2.4.6.js";
const GAIN = 0.35;
const DUCK_GAIN = 0.06;
const DUCK_MS = 420;

let fluidPromise = null;
let enginePromise = null;
let audioCtx = null;
let synth = null;
let audioNode = null;
let playingUrl = null;
let duckTimer = 0;
let generation = 0;
const MIDI_EVENT = "wc-midi";
const MIDI_UNLOCK = "wc-midi-unlock";

function emitMidi() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(MIDI_EVENT));
}

function emitMidiUnlock() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(MIDI_UNLOCK));
}

function soundfontUrl() {
    // Bundled in public/ (web) and copied into the APK www/ tree.
    // Do not assetUrl() this — that would pull ~31MB from the API host.
    return SOUNDFONT_PATH;
}

function loadFluidScript() {
    if (typeof window === "undefined") return Promise.resolve();
    if (window.Module && window.Module._new_fluid_synth) return Promise.resolve();
    if (fluidPromise) return fluidPromise;
    fluidPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = FLUID_SRC;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Could not load FluidSynth"));
        document.head.appendChild(s);
    });
    return fluidPromise;
}

function ensureAudioContext() {
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
}

async function ensureEngine() {
    if (synth) return synth;
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
        await loadFluidScript();
        const {Synthesizer, waitForReady} = await import("js-synthesizer");
        await waitForReady();
        const ctx = ensureAudioContext();
        if (!ctx) throw new Error("No AudioContext");
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        synth = new Synthesizer();
        synth.init(ctx.sampleRate);
        audioNode = synth.createAudioNode(ctx, 8192);
        audioNode.connect(ctx.destination);
        const fontResp = await fetch(soundfontUrl(), {cache: "force-cache"});
        if (!fontResp.ok) throw new Error("Soundfont missing");
        await synth.loadSFont(await fontResp.arrayBuffer());
        synth.setGain(GAIN);
        return synth;
    })();
    try {
        return await enginePromise;
    } catch (err) {
        enginePromise = null;
        throw err;
    }
}

function isStale(gen) {
    return gen !== generation || !sfxEnabled();
}

function haltPlayer() {
    if (!synth) return;
    try {
        if (synth.isPlayerPlaying()) synth.stopPlayer();
    } catch {
        /* ignore */
    }
}

function decodeNativeBody(data) {
    if (!data) return null;
    if (data instanceof ArrayBuffer) return data.byteLength ? data : null;
    if (ArrayBuffer.isView(data)) {
        const view = data;
        return view.byteLength ? view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) : null;
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
        return data.arrayBuffer();
    }
    if (typeof data === "string") {
        const bin = atob(data.replace(/\s/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
    }
    return null;
}

async function fetchMidiNative(url, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    // OkHttp's default UA is on some CrowdSec lists.
    headers["User-Agent"] = "WorkoutChallenge/1.0 (Android)";
    return CapacitorHttp.get({
        url,
        headers,
        responseType: "arraybuffer",
    });
}

async function fetchMidiBytes(path) {
    if (!path || typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
        return null;
    }
    const url = isNativeApp() ? assetUrl(path) : path;
    await ensureFreshAccessToken();
    if (isNativeApp()) {
        const getOnce = () => fetchMidiNative(url, getAccessToken());
        let resp = await getOnce();
        if (resp.status === 401) {
            const status = await refreshAccessToken();
            if (status === "ok") resp = await getOnce();
        }
        if (resp.status < 200 || resp.status >= 300) return null;
        return await decodeNativeBody(resp.data);
    }
    const getOnce = async () => {
        const headers = {};
        const token = getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        return fetch(url, {headers, credentials: "include", cache: "no-store"});
    };
    let resp = await getOnce();
    if (resp.status === 401) {
        const status = await refreshAccessToken();
        if (status === "ok") resp = await getOnce();
    }
    if (!resp.ok) return null;
    return await resp.arrayBuffer();
}

async function playBuffer(bytes, key, {ignoreMute = false} = {}) {
    if (typeof window === "undefined") return;
    if (!ignoreMute && !sfxEnabled()) {
        await stopMidiBed();
        return;
    }
    if (!bytes || bytes.byteLength < 14) {
        await stopMidiBed();
        return;
    }
    if (playingUrl === key && synth && synth.isPlayerPlaying()) return;
    const gen = ++generation;
    try {
        if (isStale(gen) && !ignoreMute) return;
        const engine = await ensureEngine();
        if (gen !== generation) return;
        ensureAudioContext();
        if (audioCtx?.state === "suspended") await audioCtx.resume().catch(() => {});
        if (gen !== generation) return;
        if (engine.isPlayerPlaying()) {
            engine.stopPlayer();
            await engine.waitForPlayerStopped().catch(() => {});
        }
        if (gen !== generation) return;
        await engine.resetPlayer();
        if (gen !== generation) return;
        await engine.addSMFDataToPlayer(bytes);
        if (gen !== generation) return;
        engine.setPlayerLoop(-1);
        engine.setGain(GAIN);
        await engine.playPlayer();
        if (gen !== generation) {
            haltPlayer();
            playingUrl = null;
            emitMidi();
            return;
        }
        playingUrl = key;
        emitMidi();
    } catch {
        if (gen === generation) {
            playingUrl = null;
            emitMidi();
        }
    }
}

export async function startMidiBed(midiPath, {preview = false} = {}) {
    if (typeof window === "undefined") return;
    if (!preview && (!sfxEnabled() || !midiPath)) {
        await stopMidiBed();
        return;
    }
    if (!midiPath) return;
    if (playingUrl === midiPath && synth && synth.isPlayerPlaying()) return;
    const gen = generation;
    const bytes = await fetchMidiBytes(midiPath);
    if (generation !== gen) return;
    if (!preview && !sfxEnabled()) return;
    await playBuffer(bytes, midiPath, {ignoreMute: preview});
}

export async function previewMidiBytes(bytes) {
    unlockMidiBed();
    await playBuffer(bytes, "preview", {ignoreMute: true});
}

export async function stopMidiBed() {
    generation += 1;
    playingUrl = null;
    haltPlayer();
    emitMidi();
}

export function midiBedPath() {
    return playingUrl;
}

export function useMidiBedPlaying() {
    const [path, setPath] = useState(playingUrl);
    useEffect(() => {
        const sync = () => setPath(playingUrl);
        window.addEventListener(MIDI_EVENT, sync);
        return () => window.removeEventListener(MIDI_EVENT, sync);
    }, []);
    return path;
}

export function _resetMidiBedForTests() {
    generation += 1;
    playingUrl = null;
    fluidPromise = null;
    enginePromise = null;
    audioCtx = null;
    synth = null;
    audioNode = null;
    if (typeof window !== "undefined") window.clearTimeout(duckTimer);
    duckTimer = 0;
}

export function duckMidiBed() {
    if (!synth || !playingUrl) return;
    try {
        synth.setGain(DUCK_GAIN);
    } catch {
        return;
    }
    window.clearTimeout(duckTimer);
    duckTimer = window.setTimeout(() => {
        try {
            if (synth && playingUrl) synth.setGain(GAIN);
        } catch {
            /* ignore */
        }
    }, DUCK_MS);
}

export function unlockMidiBed() {
    // Sync on the tap stack so Android actually starts the context.
    ensureAudioContext();
    if (sfxEnabled()) emitMidiUnlock();
}

export function installMidiUnlock() {
    if (typeof window === "undefined") return () => {};
    const go = () => {
        unlockMidiBed();
        window.removeEventListener("pointerdown", go);
        window.removeEventListener("keydown", go);
    };
    window.addEventListener("pointerdown", go, {passive: true});
    window.addEventListener("keydown", go);
    return () => {
        window.removeEventListener("pointerdown", go);
        window.removeEventListener("keydown", go);
    };
}

if (typeof window !== "undefined") {
    window.addEventListener("wc-sfx-play", () => duckMidiBed());
    window.addEventListener("wc-sfx", () => {
        if (sfxEnabled()) unlockMidiBed();
        else stopMidiBed();
    });
}

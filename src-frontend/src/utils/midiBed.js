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

async function ensureEngine() {
    if (synth) return synth;
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
        await loadFluidScript();
        const {Synthesizer, waitForReady} = await import("js-synthesizer");
        await waitForReady();
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = audioCtx || new AC();
        if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
        synth = new Synthesizer();
        synth.init(audioCtx.sampleRate);
        audioNode = synth.createAudioNode(audioCtx, 8192);
        audioNode.connect(audioCtx.destination);
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

async function fetchMidiBytes(path) {
    if (!path) return null;
    const url = path.startsWith("http") ? path : (isNativeApp() ? assetUrl(path) : path);
    await ensureFreshAccessToken();
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

export async function startMidiBed(midiPath) {
    if (typeof window === "undefined") return;
    if (!sfxEnabled() || !midiPath) {
        await stopMidiBed();
        return;
    }
    if (playingUrl === midiPath && synth && synth.isPlayerPlaying()) return;
    const gen = ++generation;
    try {
        const bytes = await fetchMidiBytes(midiPath);
        if (isStale(gen)) return;
        if (!bytes || bytes.byteLength < 14) {
            await stopMidiBed();
            return;
        }
        const engine = await ensureEngine();
        if (isStale(gen)) return;
        if (audioCtx?.state === "suspended") await audioCtx.resume().catch(() => {});
        if (isStale(gen)) return;
        if (engine.isPlayerPlaying()) {
            engine.stopPlayer();
            await engine.waitForPlayerStopped().catch(() => {});
        }
        if (isStale(gen)) return;
        await engine.resetPlayer();
        if (isStale(gen)) return;
        await engine.addSMFDataToPlayer(bytes);
        if (isStale(gen)) return;
        engine.setPlayerLoop(-1);
        engine.setGain(GAIN);
        await engine.playPlayer();
        if (isStale(gen)) {
            haltPlayer();
            playingUrl = null;
            return;
        }
        playingUrl = midiPath;
    } catch {
        if (!isStale(gen)) playingUrl = null;
    }
}

export async function stopMidiBed() {
    generation += 1;
    playingUrl = null;
    haltPlayer();
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
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

if (typeof window !== "undefined") {
    window.addEventListener("wc-sfx-play", () => duckMidiBed());
}

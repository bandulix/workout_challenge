import {createHash} from "crypto";
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";

// GeneralUser GS v2.0.3. Fail `npm run build` (Docker/APK) if this is
// missing or the bytes do not match; `npm start` warns and continues.
const SF2_URL = "https://github.com/mrbumpy409/GeneralUser-GS/raw/97049183643d5fc5a9322a69c5b09efb667c6c3a/GeneralUser-GS.sf2";
const SF2_SHA256 = "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe";
const SF2_MIN_BYTES = 30_000_000;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const synthDir = join(root, "public", "synth");
const fontDir = join(root, "public", "soundfonts");
mkdirSync(synthDir, {recursive: true});
mkdirSync(fontDir, {recursive: true});

const strict = process.env.npm_lifecycle_event !== "prestart";

function fail(msg) {
    process.stderr.write(`${msg}\n`);
    process.exit(strict ? 1 : 0);
}

function sha256(buf) {
    return createHash("sha256").update(buf).digest("hex");
}

function sf2Ok(buf) {
    return buf.length >= SF2_MIN_BYTES
        && buf.subarray(0, 4).toString("ascii") === "RIFF"
        && buf.subarray(8, 12).toString("ascii") === "sfbk"
        && sha256(buf) === SF2_SHA256;
}

const fluidSrc = join(root, "node_modules", "js-synthesizer", "externals", "libfluidsynth-2.4.6.js");
const fluidDest = join(synthDir, "libfluidsynth-2.4.6.js");
if (existsSync(fluidSrc)) {
    copyFileSync(fluidSrc, fluidDest);
} else if (!existsSync(fluidDest)) {
    fail("FluidSynth JS missing (js-synthesizer not installed). MIDI beds need public/synth/libfluidsynth-2.4.6.js");
}

const sf2 = join(fontDir, "GeneralUser-GS.sf2");
if (existsSync(sf2) && sf2Ok(readFileSync(sf2))) {
    process.exit(0);
}

process.stderr.write(`Downloading GeneralUser GS soundfont (${SF2_URL})…\n`);
let res;
try {
    res = await fetch(SF2_URL);
} catch (err) {
    fail(`Soundfont download failed (${err}). MIDI beds need public/soundfonts/GeneralUser-GS.sf2`);
}
if (!res.ok) {
    fail(`Soundfont download failed (${res.status}). MIDI beds need public/soundfonts/GeneralUser-GS.sf2`);
}
const buf = Buffer.from(await res.arrayBuffer());
if (!sf2Ok(buf)) {
    fail(`Soundfont bytes failed size/magic/sha256 check (${buf.length} bytes, sha256 ${sha256(buf)})`);
}
writeFileSync(sf2, buf);
process.stderr.write(`Wrote ${sf2} (${buf.length} bytes)\n`);

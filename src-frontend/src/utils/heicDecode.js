// HEIC/HEIF decode helper. Samsung Galaxy gallery picks come back as
// HEIC (often with an empty or octet-stream MIME), which Chrome and the
// Android WebView cannot decode via createImageBitmap - previews then
// render as a broken image. The upload itself always worked (the server
// re-encodes); only the local decode needs help.
//
// heic-to is lazy-loaded (~1 MB decoder) so only HEIC picks pay for it,
// and it's the /csp build on purpose: the plain build (like heic2any,
// which we used before) runs emscripten glue that calls new Function
// inside its Web Worker, which our CSP's script-src forbids - and the
// conversion promise then NEVER settles, leaving the picker on the
// loading dots forever. The /csp build decodes in plain JS.

// A hung conversion must surface as the caller's normal "can't decode"
// error path, never as an endless spinner - so race with a timeout.
const HEIC_DECODE_TIMEOUT_MS = 60 * 1000;

function withTimeout(promise) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("HEIC conversion timed out")), HEIC_DECODE_TIMEOUT_MS);
        }),
    ]);
}

async function convertHeic(file) {
    const {heicTo} = await import("heic-to/csp");
    return withTimeout(heicTo({blob: file, type: "image/jpeg", quality: 0.9}));
}

export function looksLikeHeic(file) {
    const type = (file?.type || "").toLowerCase();
    if (/hei[cf]|heix/.test(type)) return true;
    return /\.(heic|heif|heix)$/i.test(file?.name || "");
}

// Decode a picked photo to an ImageBitmap, converting HEIC via
// heic2any when the platform decoder rejects it. Throws when the file
// is genuinely undecodable.
export async function decodePhoto(file) {
    try {
        return await createImageBitmap(file);
    } catch (nativeError) {
        const blob = await convertHeic(file);
        try {
            return await createImageBitmap(blob);
        } catch {
            throw nativeError;
        }
    }
}

// Object URL suitable for <img src>: the raw file when the platform
// can decode it, otherwise a JPEG conversion. Callers must revoke.
export async function displayableImageUrl(file) {
    try {
        const probe = await createImageBitmap(file);
        probe.close?.();
        return URL.createObjectURL(file);
    } catch {
        return URL.createObjectURL(await convertHeic(file));
    }
}

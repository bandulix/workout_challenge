// HEIC/HEIF decode helper. Samsung Galaxy gallery picks come back as
// HEIC (often with an empty or octet-stream MIME), which Chrome and the
// Android WebView cannot decode via createImageBitmap - previews then
// render as a broken image. The upload itself always worked (the server
// re-encodes); only the local decode needs help.
//
// heic2any is lazy-loaded: ~1 MB of WASM that only HEIC picks ever pay
// for, so it stays out of the main bundle.

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
        const {default: heic2any} = await import("heic2any");
        const out = await heic2any({blob: file, toType: "image/jpeg", quality: 0.9});
        const blob = Array.isArray(out) ? out[0] : out;
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
        const {default: heic2any} = await import("heic2any");
        const out = await heic2any({blob: file, toType: "image/jpeg", quality: 0.9});
        return URL.createObjectURL(Array.isArray(out) ? out[0] : out);
    }
}

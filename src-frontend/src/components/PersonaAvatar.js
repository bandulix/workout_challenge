import React, {useState} from "react";
import {useProtectedImage} from "../utils/protectedMedia";

// Central persona identity component: renders the persona's profile
// picture (custom upload, built-in artwork key or emoji) with an
// optional glow ring in the persona's theme colour.
//
// Custom uploads are not public: the API hands out an authenticated
// endpoint URL, which <img> can't load directly (no JWT header) - it is
// fetched with credentials and rendered from an object URL.

const ARTWORK_RE = /^[a-z0-9_-]+$/;
const FALLBACK_ART = "/personas/megaphone.svg";

export function personaAvatarSrc(avatar) {
    if (avatar && ARTWORK_RE.test(avatar)) return `/personas/${avatar}.svg`;
    return null;
}

// Native disk-cache URLs from Capacitor.convertFileSrc
// (https://localhost/_capacitor_file_/… or capacitor://localhost/…).
function isCapacitorLocalSrc(url) {
    try {
        const parsed = new URL(url);
        const host = (parsed.hostname || "").toLowerCase();
        if (host !== "localhost" && host !== "127.0.0.1") return false;
        const scheme = (parsed.protocol || "").toLowerCase();
        if (scheme !== "https:" && scheme !== "http:" && scheme !== "capacitor:") return false;
        return parsed.pathname.startsWith("/_capacitor_file_")
            || parsed.pathname.startsWith("/_capacitor_content_");
    } catch {
        return false;
    }
}

// Only browser-minted object URLs (blob:), image data URLs (CapacitorHttp
// fallback), Capacitor local-file URLs (disk cache) and same-origin
// relative paths may ever reach <img src>. The persona payload is server
// data (and the editor preview is a DOM-derived string), so anything
// else - e.g. a protocol-relative //host or an exotic scheme - is
// refused outright.
export function safeImageSrc(url) {
    if (typeof url !== "string") return null;
    if (url.startsWith("blob:")) return url;
    if (url.startsWith("data:image/")) return url;
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    if (isCapacitorLocalSrc(url)) return url;
    return null;
}

export function usePersonaImageSrc(persona, size = "avatar") {
    const avatar = persona?.avatar;
    const picture = persona?.profile_picture;
    const isEmoji = !picture && avatar && !ARTWORK_RE.test(avatar);
    const isLocalPreview = !!picture && picture.startsWith("blob:");
    const {src: fetchedSrc, failed: fetchFailed} = useProtectedImage(
        picture && !isLocalPreview ? picture : null,
        size,
    );

    let requested;
    if (isEmoji) requested = null;
    else if (!picture) requested = personaAvatarSrc(avatar) || FALLBACK_ART;
    else if (isLocalPreview) requested = picture;
    else if (fetchFailed) requested = FALLBACK_ART;
    else requested = fetchedSrc;

    const [failedSrc, setFailedSrc] = useState(null);
    const src = safeImageSrc(requested && failedSrc === requested ? FALLBACK_ART : requested);
    return {src, isEmoji, onError: () => setFailedSrc(requested)};
}

function PersonaAvatar({persona, size = 48, ring = true, glow = false, className = ""}) {
    const color = persona?.theme_color || "#d7ff3e";
    const {src, isEmoji, onError} = usePersonaImageSrc(persona);

    const ringStyle = ring
        ? {boxShadow: `0 0 0 2px ${color}${glow ? `, 0 0 18px ${color}66` : ""}`}
        : undefined;

    return (
        <div
            className={"relative shrink-0 rounded-full overflow-hidden bg-gray-200 dark:bg-ink-800 " + className}
            style={{width: size, height: size, ...ringStyle}}
            aria-label={persona?.name ? `${persona.name} avatar` : "Coach avatar"}
        >
            {isEmoji ? (
                <div className="w-full h-full flex items-center justify-center" style={{fontSize: size * 0.55}}>
                    {persona?.avatar}
                </div>
            ) : src ? (
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="w-full h-full object-cover select-none"
                    onError={onError}
                />
            ) : null}
        </div>
    );
}

export default PersonaAvatar;

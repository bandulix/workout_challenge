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

// Only browser-minted object URLs (blob:) and same-origin relative paths
// may ever reach <img src>. The persona payload is server data (and the
// editor preview is a DOM-derived string), so anything else - e.g. a
// protocol-relative //host or an exotic scheme - is refused outright.
export function safeImageSrc(url) {
    if (typeof url !== "string") return null;
    if (url.startsWith("blob:")) return url;
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    return null;
}

function PersonaAvatar({persona, size = 48, ring = true, glow = false, className = ""}) {
    const avatar = persona?.avatar;
    const picture = persona?.profile_picture;
    const color = persona?.theme_color || "#d7ff3e";
    const isEmoji = !picture && avatar && !ARTWORK_RE.test(avatar);

    // blob: URLs (the editor's pre-upload preview) are used directly;
    // API URLs go through the authenticated fetch.
    const isLocalPreview = !!picture && picture.startsWith("blob:");
    const {src: fetchedSrc, failed: fetchFailed} = useProtectedImage(
        picture && !isLocalPreview ? picture : null
    );

    // The src is derived from the props on every render (a changed
    // persona must show its new face immediately). The only state is
    // "which src failed to load", so the onError fallback resets itself
    // as soon as the persona changes.
    let requested;
    if (!picture) requested = personaAvatarSrc(avatar) || FALLBACK_ART;
    else if (isLocalPreview) requested = picture;
    else if (fetchFailed) requested = FALLBACK_ART;
    else requested = fetchedSrc; // null while the protected fetch is in flight

    const [failedSrc, setFailedSrc] = useState(null);
    const src = safeImageSrc(requested && failedSrc === requested ? FALLBACK_ART : requested);

    const ringStyle = ring
        ? {boxShadow: `0 0 0 2px ${color}${glow ? `, 0 0 18px ${color}66` : ""}`}
        : undefined;

    return (
        <div
            className={"relative shrink-0 rounded-full overflow-hidden bg-ink-800 " + className}
            style={{width: size, height: size, ...ringStyle}}
            aria-label={persona?.name ? `${persona.name} avatar` : "Coach avatar"}
        >
            {isEmoji ? (
                <div className="w-full h-full flex items-center justify-center" style={{fontSize: size * 0.55}}>
                    {avatar}
                </div>
            ) : src ? (
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="w-full h-full object-cover select-none"
                    onError={() => setFailedSrc(requested)}
                />
            ) : null}
        </div>
    );
}

export default PersonaAvatar;

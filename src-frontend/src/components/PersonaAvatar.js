import React, {useState} from "react";

// Central persona identity component: renders the persona's profile
// picture (built-in artwork, custom artwork key or emoji) with an
// optional glow ring in the persona's theme colour.

const ARTWORK_RE = /^[a-z0-9_-]+$/;
const FALLBACK_ART = "/personas/megaphone.svg";

export function personaAvatarSrc(avatar) {
    if (avatar && ARTWORK_RE.test(avatar)) return `/personas/${avatar}.svg`;
    return null;
}

function PersonaAvatar({persona, size = 48, ring = true, glow = false, className = ""}) {
    const avatar = persona?.avatar;
    const color = persona?.theme_color || "#d7ff3e";
    const [src, setSrc] = useState(() => personaAvatarSrc(avatar) || FALLBACK_ART);
    const isEmoji = avatar && !ARTWORK_RE.test(avatar);

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
            ) : (
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="w-full h-full object-cover select-none"
                    onError={() => {
                        if (src !== FALLBACK_ART) setSrc(FALLBACK_ART);
                    }}
                />
            )}
        </div>
    );
}

export default PersonaAvatar;

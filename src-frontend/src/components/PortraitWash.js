import React from "react";
import {safeImageSrc} from "./PersonaAvatar";

/** Blurred, tinted portrait filling a glass card. Renders nothing without a safe src. */
export default function PortraitWash({src, color = "#d7ff3e", intensity = 0, onError}) {
    const safe = safeImageSrc(src);
    if (!safe) return null;
    const glow = 0.2 + 0.1 * Number(intensity || 0);
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl" aria-hidden="true">
            <img src={safe} alt="" draggable={false} className="portrait-wash" onError={onError}/>
            <div className="portrait-wash-tint" style={{background: color, opacity: 0.14 + 0.08 * Number(intensity || 0)}}/>
            <div className="absolute -top-20 -right-12 h-72 w-72 rounded-full blur-3xl"
                 style={{background: color, opacity: glow}}/>
            <div className="portrait-wash-veil"/>
        </div>
    );
}

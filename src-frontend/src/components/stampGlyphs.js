import React from "react";

const INK = "#0b0b0c";
const W = "#fff";
const TONGUE = "#ff4d6d";

function Shine() {
    return <ellipse cx="12" cy="10.5" rx="3.1" ry="1.8" fill={W} opacity=".32"/>;
}

function Dots({x = 11.2, y = 14.2, gap = 8.2, r = 1.55}) {
    return (
        <>
            <circle cx={x} cy={y} r={r} fill={INK}/>
            <circle cx={x + gap} cy={y} r={r} fill={INK}/>
            <circle cx={x - 0.45} cy={y - 0.5} r={0.5} fill={W}/>
            <circle cx={x + gap - 0.45} cy={y - 0.5} r={0.5} fill={W}/>
        </>
    );
}

function Shades({y = 13}) {
    return (
        <g fill={INK}>
            <rect x="7.4" y={y} width="7.3" height="4.3" rx="1.5"/>
            <rect x="17.3" y={y} width="7.3" height="4.3" rx="1.5"/>
            <rect x="14.4" y={y + 1.3} width="3.2" height="1.3" rx="0.4"/>
        </g>
    );
}

const GLYPH = {
    // LIT — cocky flame.
    fire: (
        <>
            <path d="M16 2c0 5.4-8 8.2-8 16.6A8 8 0 0 0 16 30a8 8 0 0 0 8-11.4C24 11 19.4 8 17.4 3.2 16.8 8.4 15.2 11 16 2Z"/>
            <Dots x="12.4" y="16.6" gap="7.2" r="1.45"/>
            <path d="M12.6 21.2q3.4 3.2 6.8 0" fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round"/>
            <Shine/>
        </>
    ),
    // SWOLE — classic gun show.
    beast: (
        <>
            <path d="M7 20.4c0-5.6 4.2-9.2 9.6-8.4 1.4.2 2.2-2.2 3.6-4 2.2 2.6 1.2 5.4-.4 7 3.6 1.2 7.4 3.8 7.6 8.2-.2 3.8-6.8 5.8-12.8 4.8C9.2 27 7 24.2 7 20.4Z"/>
            <path d="M10.2 13.2c2.2-.8 3.6.4 3.4 2.2" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M14.2 19.4h5.2v1.8H14.2z" fill={INK}/>
            <circle cx="13.2" cy="17.4" r="1.2" fill={INK}/>
            <circle cx="20.4" cy="17.2" r="1.2" fill={INK}/>
        </>
    ),
    // ZAP — fat bolt.
    volt: (
        <>
            <path d="M18.8 1.4 6.6 16.8h8.2L11 30.6 25.6 13.4h-8.4L18.8 1.4Z"/>
            <circle cx="19.6" cy="6.2" r="1.6" fill={W} opacity=".45"/>
        </>
    ),
    // GOAT — smug goat, tiny crown. Keep.
    goat: (
        <>
            <path d="M7.2 11.4C3.2 3.2 11.4 5 13.2 11.6c.4 1.4-1.6 2-2.6 1.1-.9-.8-2.2-.9-3.4-1.3Z"/>
            <path d="M24.8 11.4C28.8 3.2 20.6 5 18.8 11.6c-.4 1.4 1.6 2 2.6 1.1.9-.8 2.2-.9 3.4-1.3Z"/>
            <circle cx="16" cy="18.6" r="9"/>
            <path d="M13.2 3.4 16 7.2 18.8 3.4 16.9 10h-1.8Z"/>
            <Dots x="12.4" y="17.6" gap="7.4" r="1.5"/>
            <path d="M14.4 25.2c.6 2.4 2.6 2.4 3.2 0" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round"/>
            <path d="M12.6 21.8q3.4-1.6 6.8.4" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round"/>
            <Shine/>
        </>
    ),
    // W — the dub.
    podium: (
        <path d="M3.6 5.2h6.2l2.4 12.6L16 8.4l3.8 9.4L22.2 5.2h6.2l-4.8 21.6h-6.2L16 16.6l-1.4 10.2H8.4Z"/>
    ),
    // SEND IT — clean rocket.
    rocket: (
        <>
            <path d="M16 1.8c4.8 5.6 5.8 12.6 5.2 19h-10.4C10.2 14.4 11.2 7.4 16 1.8Z"/>
            <circle cx="16" cy="11.6" r="3.2" fill={W} opacity=".4"/>
            <path d="M10.8 16.2 5.4 24.2l5.6-1.6Z"/>
            <path d="M21.2 16.2 26.6 24.2l-5.6-1.6Z"/>
            <path d="M12 20.8c0 4 2.2 7.2 4 9.2 1.8-2 4-5.2 4-9.2Z"/>
        </>
    ),
    // TOO COOL — ice-cube chad. Keep.
    ice: (
        <>
            <rect x="5.2" y="6.4" width="21.6" height="20.4" rx="5.2"/>
            <path d="M8.4 10.2h4.2v2.1H8.4zM19.4 20.8h4.2v2.1h-4.2z" fill={W} opacity=".35"/>
            <Shades y="12.6"/>
            <path d="M12.4 20.6q3.6 2.8 7.2 0" fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round"/>
        </>
    ),
    // WTF! — jaw on the floor.
    how: (
        <>
            <path d="M7.6 9.2 5.2 4.8M16 7.4V2.2M24.4 9.2 26.8 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
            <circle cx="16" cy="19" r="10.2"/>
            <circle cx="11.6" cy="16.4" r="3.1" fill={W}/>
            <circle cx="20.6" cy="16.4" r="3.1" fill={W}/>
            <circle cx="12" cy="16.8" r="1.25" fill={INK}/>
            <circle cx="21" cy="16.8" r="1.25" fill={INK}/>
            <ellipse cx="16" cy="23.8" rx="4.4" ry="3.2" fill={INK}/>
            <ellipse cx="16" cy="24.4" rx="2.4" ry="1.5" fill={TONGUE}/>
        </>
    ),
    // FERAL — wink devil.
    menace: (
        <>
            <path d="M6.4 8.8C2.6 1.6 12.4 4.8 13.2 11.4Z"/>
            <path d="M25.6 8.8C29.4 1.6 19.6 4.8 18.8 11.4Z"/>
            <circle cx="16" cy="18.8" r="9.4"/>
            <path d="M10.8 17q2.4-2.4 4.4 0" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round"/>
            <circle cx="20.4" cy="17.4" r="1.7" fill={INK}/>
            <circle cx="19.9" cy="16.9" r=".5" fill={W}/>
            <path d="M11.8 21.6q4.4 4 8.8 0" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round"/>
            <Shine/>
        </>
    ),
    // RIP — clean skull.
    dead: (
        <>
            <ellipse cx="16" cy="14" rx="10.6" ry="9.8"/>
            <path d="M11 21.4h10v5.6c0 1.6-2.2 2.8-5 2.8s-5-1.2-5-2.8Z"/>
            <ellipse cx="12.2" cy="14.2" rx="2.4" ry="2.8" fill={INK}/>
            <ellipse cx="19.8" cy="14.2" rx="2.4" ry="2.8" fill={INK}/>
            <rect x="12.4" y="23.4" width="1.4" height="2.6" fill={INK}/>
            <rect x="15.3" y="23.4" width="1.4" height="2.6" fill={INK}/>
            <rect x="18.2" y="23.4" width="1.4" height="2.6" fill={INK}/>
        </>
    ),
    // COOKED — dripping, done.
    melted: (
        <>
            <path d="M8 12.2a8.2 8.2 0 1 1 15.8 3c.3 2.6-1.4 4.2-2.2 6.2-.8 1.8.2 3.8-1.5 4.8-1.4.8-2.6-.8-3.2-2.2-.6 2.2-2.4 4.6-4.4 3.6-1.8-.8-.8-3.4-.6-5.2.4-2.2-1.8-3.6-2.6-5.6C8.5 15.2 9.4 13.6 8 12.2Z"/>
            <Dots x="12.4" y="13.2" gap="7.2" r="1.4"/>
            <path d="M12.4 17.6q3.6-.8 7.2.6" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round"/>
            <path d="M24.2 10.8c1.4-1.6 3.2-1.8 4.2-.4" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round"/>
        </>
    ),
    // OOF — pancake under a barbell. Keep.
    heavy: (
        <>
            <rect x="1.8" y="4.8" width="4.2" height="8.4" rx="1.1"/>
            <rect x="6" y="6.4" width="3" height="5.4" rx=".7"/>
            <rect x="9" y="8.2" width="14" height="2.2" rx="1"/>
            <rect x="23" y="6.4" width="3" height="5.4" rx=".7"/>
            <rect x="26" y="4.8" width="4.2" height="8.4" rx="1.1"/>
            <ellipse cx="16" cy="21.2" rx="11.4" ry="7.2"/>
            <Dots x="11.4" y="20.2" gap="9.2" r="1.7"/>
            <path d="M13.2 24.6q2.8-1.8 5.6 0" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round"/>
            <circle cx="24.4" cy="18.2" r="1.3" fill={W} opacity=".7"/>
        </>
    ),
    // RESPECT — fist bump.
    salute: (
        <>
            <path d="M8.4 14.2c0-2.4 1.6-4.2 3.6-4.2 1 0 1.8.6 2.2 1.4.4-1.6 1.6-2.6 3.2-2.6 2.2 0 3.6 1.8 3.6 4 0 .6-.1 1.2-.3 1.6.8-.4 1.8-.4 2.6.2 1.2.8 1.4 2.2.8 3.4-.4.8-1.2 1.4-2.2 1.6v5.2c0 1.4-1.2 2.6-2.8 2.6H12.6c-2.4 0-4.2-2-4.2-4.4v-8.8Z"/>
            <path d="M12.2 11.2v6.4M15.4 9.6v8M18.6 11.4v6.2" fill="none" stroke={INK} strokeWidth="1.35" strokeLinecap="round"/>
        </>
    ),
    // HEART — one fat heart, a spark.
    love: (
        <>
            <path d="M16 28.4S5.2 20.4 5.2 12.8C5.2 8.4 8.4 6 12 6c2.2 0 3.6 1.2 4 2.4.4-1.2 1.8-2.4 4-2.4 3.6 0 6.8 2.4 6.8 6.8 0 7.6-10.8 15.6-10.8 15.6Z"/>
            <path d="M22.8 7.2 24.6 4.2 26.4 7.2 29.6 8.4 26.4 10l-.2 3.4-2.4-2.4-3.2.6 1.8-2.8Z" fill={W} opacity=".55"/>
        </>
    ),
};

export default function StampGlyph({id, size = 20, glow}) {
    const body = GLYPH[id];
    if (!body) return null;
    return (
        <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true"
             className="react-glyph overflow-visible" fill="currentColor"
             style={{color: glow}}>
            {body}
        </svg>
    );
}

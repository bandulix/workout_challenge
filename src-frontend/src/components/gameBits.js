import React from "react";
import {Megaphone, Radio, ScrollText, Trophy} from "lucide-react";
import {BoxSection} from "../utils/miscellaneous";
import {useProtectedImage} from "../utils/protectedMedia";
import ProfileAvatar from "./ProfileAvatar";
import {SectionHead} from "./uiBits";

export const TAG_ICON = {
    first_blood: "🩸",
    ghost_killer: "👻",
    photogenic: "📸",
    never_missed_monday: "📅",
    survived_the_dunce: "📣",
};

export function MoodMeter({mood, personaName}) {
    if (!mood) return null;
    const width = ["12%", "38%", "68%", "100%"][mood.intensity] || "12%";
    const tone = {
        unleashed: "text-volt-400",
        proud: "text-volt-300",
        watching: "text-amber-300",
        disappointed: "text-red-400",
    }[mood.key] || "text-gray-300";
    return (
        <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
                <p className={"text-[11px] font-bold uppercase tracking-[0.18em] " + tone}>
                    <Radio className="inline h-3 w-3 mr-1"/>{personaName || "Coach"} is {mood.label}
                </p>
                <span className="text-[10px] text-gray-500">{mood.active_48h}/{mood.participants} moved</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-volt-400 shadow-glow-volt transition-all duration-700"
                     style={{width}}/>
            </div>
            <p className="mt-2 text-xs text-gray-400 italic">{mood.line}</p>
        </div>
    );
}

export function OrderCard({order}) {
    if (!order) return null;
    return (
        <BoxSection>
            <SectionHead title="Order of the day" hint={order.competition_name}/>
            <div className="mt-3 rounded-2xl border border-volt-400/40 bg-ink-900 text-white p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-volt-400 flex items-center gap-1.5">
                    <ScrollText className="h-3.5 w-3.5"/> Sealed order · {order.date}
                </p>
                <p className="mt-2 text-[15px] leading-relaxed">{order.brief}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {order.completed ? (
                        <span className="rounded-full bg-volt-400 text-ink-950 text-[10px] font-extrabold uppercase tracking-wide px-2.5 py-1">
                            You completed it
                        </span>
                    ) : (
                        <span className="rounded-full bg-white/10 text-gray-300 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1">
                            Still open
                        </span>
                    )}
                    {order.completers?.length > 0 && (
                        <span className="text-[11px] text-gray-400">
                            {order.completers.map((c) => c.first_name).join(", ")}
                        </span>
                    )}
                </div>
            </div>
        </BoxSection>
    );
}

function HallFrame({card, place}) {
    const {src} = useProtectedImage(card.image);
    return (
        <div className="min-w-0 flex-1">
            <div className="relative rounded-xl p-1 bg-gradient-to-br from-yellow-500 via-amber-200 to-yellow-700 shadow-card">
                {src ? (
                    <img src={src} alt="" className="h-36 w-full object-cover rounded-lg"/>
                ) : (
                    <div className="h-36 rounded-lg bg-ink-900"/>
                )}
                <span className="absolute top-2 left-2 rounded-full bg-ink-950/80 text-volt-400 text-[10px] font-extrabold px-2 py-0.5">
                    #{place}
                </span>
            </div>
            <p className="mt-1.5 text-xs text-gray-500 truncate">
                {card.athlete_name || "Athlete"} · {card.hot_votes || 0} hot
            </p>
        </div>
    );
}

export function HallOfRoasts({cards}) {
    if (!cards || cards.length === 0) return null;
    return (
        <BoxSection>
            <SectionHead title="Hall of roasts" hint="Top remixed photos this challenge"/>
            <div className="mt-3 flex gap-3">
                {cards.map((c, i) => <HallFrame key={c.id} card={c} place={i + 1}/>)}
            </div>
        </BoxSection>
    );
}

export function DogTagRow({tags}) {
    if (!tags || tags.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((t) => (
                <span key={t.slug}
                      title={t.blurb || t.title}
                      className="inline-flex items-center gap-1 rounded-full border border-ink-700/40 bg-ink-900 text-volt-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                    <span aria-hidden="true">{TAG_ICON[t.slug] || "★"}</span>
                    {t.title}
                </span>
            ))}
        </div>
    );
}

export function DunceBadge({show, size = 18}) {
    if (!show) return null;
    return (
        <span title="Dunce megaphone — last on the board until they log"
              className="absolute -top-1 -left-1 z-10 h-6 w-6 rounded-full bg-ink-950 border border-volt-400 text-volt-400 flex items-center justify-center shadow-glow-volt"
              style={{width: size, height: size}}>
            <Megaphone className="h-3 w-3"/>
        </span>
    );
}

export function OrderRibbon({show}) {
    if (!show) return null;
    return (
        <span className="shrink-0 rounded-full bg-volt-400 text-ink-950 text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 inline-flex items-center gap-1">
            <Trophy className="h-3 w-3"/> Order
        </span>
    );
}

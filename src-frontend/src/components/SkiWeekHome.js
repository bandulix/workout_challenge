import React, {useEffect, useState} from "react";
import {Share2} from "lucide-react";
import PersonaAvatar from "./PersonaAvatar";
import ProfileAvatar from "./ProfileAvatar";
import {toast} from "../utils/toasts";
import {
    countdownParts,
    freshSnowLabel,
    pad2,
    shareText,
    snowingNow,
    visiblePhase,
} from "../utils/skiweek";

function useNow(pinned) {
    const [now, setNow] = useState(() => pinned || new Date());
    useEffect(() => {
        if (pinned) {
            setNow(pinned);
            return undefined;
        }
        const id = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(id);
    }, [pinned]);
    return pinned || now;
}

function Mountain() {
    return (
        <svg className="ski-ridge" viewBox="0 0 400 90" aria-hidden="true" preserveAspectRatio="none">
            <path fill="#07101c" d="M0 90 L0 58 L48 40 L92 62 L140 22 L188 54 L236 18 L290 50 L340 28 L400 56 L400 90 Z"/>
            <path fill="#9BE7FF" opacity="0.55" d="M140 22 L156 40 L128 38 Z M236 18 L252 36 L220 34 Z"/>
        </svg>
    );
}

function Flakes({on}) {
    if (!on) return null;
    return (
        <div className="ski-flakes" aria-hidden="true">
            <span/><span/><span/><span/><span/>
        </div>
    );
}

function CountCell({value, label}) {
    return (
        <div className="ski-cell">
            <div className="ski-num">{value}</div>
            <div className="ski-cell-label">{label}</div>
        </div>
    );
}

function SnowReport({weather}) {
    const current = weather?.current || {};
    const fresh = freshSnowLabel(weather);
    const opening = weather?.opening_days || [];
    return (
        <section className="ski-snow" aria-label="Snow report">
            {fresh && <p className="ski-fresh">{fresh}</p>}
            <div className="ski-snow-grid">
                <div><span>Tal</span><strong>{current.snow_valley_cm ?? "–"}<small> cm</small></strong></div>
                <div><span>Berg</span><strong>{current.snow_summit_cm ?? "–"}<small> cm</small></strong></div>
                <div><span>24h</span><strong>{weather?.snowfall_24h_cm ?? "–"}<small> cm</small></strong></div>
                <div><span>72h</span><strong>{weather?.snowfall_72h_cm ?? "–"}<small> cm</small></strong></div>
            </div>
            <p className="ski-meta">
                {current.label ? `${current.label}` : "Weather"}
                {current.temperature_c != null ? ` · ${current.temperature_c}°` : ""}
                {current.freezing_level_m != null ? ` · freezing level ${current.freezing_level_m} m` : ""}
            </p>
            {opening.length > 0 ? (
                <ul className="ski-forecast">
                    {opening.slice(0, 3).map((day) => (
                        <li key={day.date}>
                            <span>{day.date?.slice(5)}</span>
                            <span>{day.label || "—"}</span>
                            <span>{day.snowfall_cm != null ? `${day.snowfall_cm} cm` : ""}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="ski-meta">Opening-day forecast arrives inside the 7-day window.</p>
            )}
            <p className="ski-source">{weather?.attribution || "Weather and snow: Open-Meteo.com"}</p>
        </section>
    );
}

function CoachLine({teaser}) {
    if (!teaser?.body) return null;
    const persona = teaser.persona;
    return (
        <div className="ski-coach">
            {persona ? (
                <PersonaAvatar persona={persona} size={44}/>
            ) : (
                <span className="ski-coach-mark" aria-hidden="true">▲</span>
            )}
            <div>
                {persona?.name && <p className="ski-coach-name">{persona.name}</p>}
                <p>{teaser.body}</p>
            </div>
        </div>
    );
}

function Crew({participants}) {
    const people = (participants || []).slice(0, 8);
    if (!people.length) return null;
    return (
        <ul className="ski-crew" aria-label="Joined">
            {people.map((person) => (
                <li key={person.id}>
                    <ProfileAvatar
                        user={{...person, profile_picture: person.profile_picture || (person.id ? `/api/user/${person.id}/picture/` : null)}}
                        size={36}
                    />
                    <span>{person.username}</span>
                </li>
            ))}
        </ul>
    );
}

async function shareCountdown(skiweek, now) {
    const text = shareText(skiweek, now);
    const title = skiweek?.resort?.name || "Skiwoche";
    if (typeof navigator !== "undefined" && navigator.share) {
        try {
            await navigator.share({title, text});
            return;
        } catch (err) {
            if (err?.name === "AbortError") return;
        }
    }
    try {
        await navigator.clipboard.writeText(text);
        toast.success("Countdown copied.");
    } catch {
        toast.error("Could not share the countdown.");
    }
}

export default function SkiWeekHome({skiweek, participants, variant = "hero", now: pinnedNow}) {
    const now = useNow(pinnedNow);
    if (!skiweek?.enabled) return null;
    const phase = visiblePhase(skiweek, now);
    if (phase === "ended" || phase === "off") return null;
    const parts = countdownParts(skiweek.starts_at, now);
    const resort = skiweek.resort?.name || "The Alps";
    const snowing = snowingNow(skiweek.weather);
    const kicked = phase === "live";

    if (variant === "teaser") {
        if (kicked) return null;
        return (
            <aside className="skiweek skiweek-teaser">
                <Flakes on={snowing}/>
                <p className="ski-kicker">{resort}</p>
                <p className="ski-teaser-count">
                    {parts ? `${parts.days}d ${pad2(parts.hours)}h ${pad2(parts.minutes)}m ${pad2(parts.seconds)}s` : ""}
                </p>
                {freshSnowLabel(skiweek.weather) && <p className="ski-fresh">{freshSnowLabel(skiweek.weather)}</p>}
                <CoachLine teaser={skiweek.coach_teaser}/>
            </aside>
        );
    }

    if (kicked && variant === "hero") {
        return (
            <section className={"skiweek skiweek-hero" + (snowing ? "" : " ski-kickoff")} aria-label="Ski week open">
                <Flakes on={snowing}/>
                <Mountain/>
                <p className="ski-kicker">{resort}</p>
                <h2 className="ski-open">Piste offen</h2>
                <p className="ski-meta">The week is live.</p>
                <SnowReport weather={skiweek.weather}/>
                <CoachLine teaser={skiweek.coach_teaser}/>
            </section>
        );
    }

    if (variant === "live") {
        const piste = skiweek.today?.piste || {};
        const lead = skiweek.live?.leaders?.[0];
        return (
            <section className="skiweek skiweek-live" aria-label="Today on the mountain">
                <Flakes on={snowing}/>
                <Mountain/>
                <p className="ski-kicker">Heute · {resort}</p>
                <div className="ski-live-stats">
                    <div><span>Höhenmeter</span><strong className="ski-num ski-num-sm">{Math.round(piste.elevation_m || 0)}</strong></div>
                    <div><span>Runs</span><strong className="ski-num ski-num-sm">{piste.runs || 0}</strong></div>
                    <div><span>Km</span><strong className="ski-num ski-num-sm">{piste.distance_km || 0}</strong></div>
                </div>
                <SnowReport weather={skiweek.weather}/>
                {lead && (
                    <p className="ski-lead">Sambuca lead · {lead.username} · {lead.count}{skiweek.live?.tied ? " · shared" : ""}</p>
                )}
            </section>
        );
    }

    return (
        <section className="skiweek skiweek-hero" aria-label="Ski week countdown">
            <Flakes on={snowing}/>
            <Mountain/>
            <div className="ski-hero-top">
                <div>
                    <p className="ski-kicker">Skiwoche</p>
                    <h2 className="ski-resort">{resort}</h2>
                </div>
                <button type="button" className="ski-share" onClick={() => shareCountdown(skiweek, now)}>
                    <Share2 className="h-4 w-4" aria-hidden="true"/>
                    Share
                </button>
            </div>
            {parts && (
                <div className="ski-clock" role="timer" aria-live="polite">
                    <CountCell value={String(parts.days)} label="Days"/>
                    <CountCell value={pad2(parts.hours)} label="Hours"/>
                    <CountCell value={pad2(parts.minutes)} label="Min"/>
                    <CountCell value={pad2(parts.seconds)} label="Sec"/>
                </div>
            )}
            <SnowReport weather={skiweek.weather}/>
            <CoachLine teaser={skiweek.coach_teaser}/>
            <Crew participants={participants}/>
        </section>
    );
}

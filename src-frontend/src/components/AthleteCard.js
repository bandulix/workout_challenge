import React from "react";
import {CalendarDays, Crown, Flame, Footprints, Timer} from "lucide-react";
import ProfileAvatar from "./ProfileAvatar";
import {DogTagRow} from "./gameBits";
import {sportLabelShort} from "../forms/workoutForm";
import {OverlaySheet} from "../forms/basicComponents";

function Kpi({icon: Icon, value, label}) {
    return (
        <div className="rounded-2xl glass-inset px-2.5 py-2 text-center min-w-0">
            <Icon className="h-3.5 w-3.5 mx-auto text-volt-600 dark:text-volt-400"/>
            <p className="mt-1 font-display text-lg leading-none tabular-nums text-ink-950 dark:text-white">{value}</p>
            <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
        </div>
    );
}

function sportsForUser(feed, userId) {
    const counts = {};
    for (const entry of feed || []) {
        if (entry.workout__user !== userId) continue;
        const sport = entry.workout__sport_type;
        if (!sport || sport === "Steps") continue;
        counts[sport] = (counts[sport] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
}

export default function AthleteCard({person, dunce, weekTotal, weekBars, trendSpark, feed, onClose}) {
    if (!person) return null;
    const name = person.username || "Athlete";
    const rank = person.rank;
    const points = Math.round(person.total_capped ?? person.points ?? 0);
    const tags = person.dog_tags || [];
    const echoes = Number(person.echoes_held) || 0;
    const sports = sportsForUser(feed, person.id);
    const stravaId = person.strava_allow_follow ? person.strava_athlete_id : null;

    return (
        <OverlaySheet title={name} onClose={onClose} zClass="z-[70]" labelledBy="athlete-card-name">
                <div className="flex flex-col items-center text-center">
                    <ProfileAvatar user={person} size={88} dunce={dunce}/>
                    <h2 className="mt-3 font-display text-xl uppercase tracking-wide leading-tight">
                        {name}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {rank != null ? `#${rank}` : "Unranked"}
                        {" · "}
                        {points.toLocaleString()}P
                        {person.days_on_rank > 0 && rank != null ? ` · ${person.days_on_rank}d on rank` : ""}
                    </p>
                    {dunce && (
                        <p className="mt-2 rounded-full bg-ink-950 text-volt-400 text-[10px] font-extrabold uppercase tracking-wide px-2.5 py-1">
                            Wearing the megaphone
                        </p>
                    )}
                </div>

                <div className="mt-4 grid grid-cols-4 gap-1.5">
                    <Kpi icon={Timer} value={Math.round(weekTotal || 0)} label="This week"/>
                    <Kpi icon={Footprints} value={person.workouts ?? "–"} label="Workouts"/>
                    <Kpi icon={Flame} value={person.streak ?? "–"} label="Streak"/>
                    <Kpi icon={CalendarDays} value={person.active_days ?? "–"} label="Active days"/>
                </div>

                {(weekBars || trendSpark) && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                        {weekBars && (
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-1">This week</p>
                                {weekBars}
                            </div>
                        )}
                        {trendSpark && (
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-1">Trend vs field</p>
                                {trendSpark}
                            </div>
                        )}
                    </div>
                )}

                {sports.length > 0 && (
                    <div className="mt-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-1.5">Sports</p>
                        <div className="flex flex-wrap gap-1.5">
                            {sports.map(([sport, n]) => (
                                <span key={sport}
                                      className="rounded-full glass-inset px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide">
                                    {sportLabelShort(sport)} · {n}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {echoes > 0 && (
                    <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-volt-400 text-ink-950 text-[11px] font-extrabold uppercase tracking-wide px-3 py-1 shadow-glow-volt">
                        <Crown className="h-3.5 w-3.5"/>
                        {echoes === 1 ? "Holds a Legend Echo" : `Holds ${echoes} Legend Echoes`}
                    </p>
                )}

                {tags.length > 0 && (
                    <div className="mt-4 text-left">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Dog tags</p>
                        <DogTagRow tags={tags}/>
                    </div>
                )}

                {stravaId && (
                    <a href={`https://www.strava.com/athletes/${stravaId}`}
                       target="_blank" rel="noopener noreferrer"
                       className="mt-4 inline-flex min-h-[44px] items-center rounded-full btn-glass px-4 text-xs font-bold uppercase tracking-wide">
                        Strava profile
                    </a>
                )}
        </OverlaySheet>
    );
}

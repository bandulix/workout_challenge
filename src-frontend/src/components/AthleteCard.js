import React from "react";
import {Crown} from "lucide-react";
import ProfileAvatar from "./ProfileAvatar";
import {DogTagRow} from "./gameBits";
import {StatTile} from "./polishBits";
import {recordLabel} from "../utils/duel";
import {sportLabelShort} from "../forms/workoutForm";
import {OverlaySheet} from "../forms/basicComponents";
import {topSportCounts} from "../utils/sportCounts";
import {pageResults} from "../utils/queryPage";

function sportsForUser(person, feed, userId) {
    if (person?.sports && typeof person.sports === "object" && !Array.isArray(person.sports)) {
        return Object.entries(person.sports);
    }
    const mine = pageResults(feed).filter((entry) => entry.workout__user === userId);
    return Object.entries(topSportCounts(mine, "workout__sport_type").groups);
}

export default function AthleteCard({person, weekTotal, weekBars, trendSpark, feed, onClose, onDuel, onBlock, blocked = false}) {
    if (!person) return null;
    const name = person.username || "Athlete";
    const rank = person.rank;
    const points = Math.round(person.total_capped ?? person.points ?? 0);
    const tags = person.dog_tags || [];
    const echoes = Number(person.echoes_held) || 0;
    const sports = sportsForUser(person, feed, person.id);
    const stravaId = person.strava_allow_follow ? person.strava_athlete_id : null;

    return (
        <OverlaySheet title={name} onClose={onClose} zClass="z-[70]" labelledBy="athlete-card-name">
                <div className="flex flex-col items-center text-center">
                    <ProfileAvatar user={person} size={88}/>
                    <h2 className="mt-3 font-display text-xl uppercase tracking-wide leading-tight">
                        {name}
                    </h2>
                    {recordLabel(person.duel_record) && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Duels {recordLabel(person.duel_record)}</p>
                    )}
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {rank != null ? `#${rank}` : "Unranked"}
                        {" · "}
                        {points.toLocaleString()}P
                        {person.days_on_rank > 0 && rank != null ? ` · ${person.days_on_rank}d on rank` : ""}
                    </p>
                    <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
                        {Math.round(Number(person.scaling_kcal ?? 1) * 100)}% effort
                        {" · "}
                        {Math.round(Number(person.scaling_distance ?? 1) * 100)}% distance
                    </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-left">
                    <StatTile label="This week" value={Math.round(weekTotal || 0)} unit="P" primary/>
                    <StatTile label="Workouts" value={person.workouts ?? "–"}/>
                    <StatTile label="Streak" value={person.streak ?? "–"}/>
                    <StatTile label="Active days" value={person.active_days ?? "–"}/>
                </div>

                {(weekBars || trendSpark) && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                        {weekBars && (
                            <div className="min-w-0">
                                <p className="t-caption text-gray-400 mb-1">This week</p>
                                {weekBars}
                            </div>
                        )}
                        {trendSpark && (
                            <div className="min-w-0">
                                <p className="t-caption text-gray-400 mb-1">Trend vs field</p>
                                {trendSpark}
                            </div>
                        )}
                    </div>
                )}

                {sports.length > 0 && (
                    <div className="mt-4">
                        <p className="t-caption text-gray-400 mb-1.5">Sports</p>
                        <div className="flex flex-wrap gap-1.5">
                            {sports.map(([sport, n]) => (
                                <span key={sport}
                                      className="rounded-full glass-inset px-2.5 py-1 text-xs font-bold uppercase tracking-wide">
                                    {sportLabelShort(sport)} · {n}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {echoes > 0 && (
                    <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-volt-400 text-ink-950 text-xs font-extrabold uppercase tracking-wide px-3 py-1 shadow-glow-volt">
                        <Crown className="h-3.5 w-3.5"/>
                        {echoes === 1 ? "Holds a Legend Echo" : `Holds ${echoes} Legend Echoes`}
                    </p>
                )}

                {tags.length > 0 && (
                    <div className="mt-4 text-left">
                        <p className="t-caption text-gray-400">Dog tags</p>
                        <DogTagRow tags={tags}/>
                    </div>
                )}

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {onDuel && (
                        <button type="button" onClick={() => onDuel(person)} className="min-h-[44px] btn-plate px-4 text-xs font-bold">
                            Duel
                        </button>
                    )}
                    {onBlock && (
                        <button type="button" onClick={() => onBlock(person)} className="min-h-[44px] btn-plate-ink px-4 text-xs font-semibold">
                            {blocked ? "Unblock duel invites" : "Block duel invites"}
                        </button>
                    )}
                </div>

                {stravaId && (
                    <a href={`https://www.strava.com/athletes/${stravaId}`}
                       target="_blank" rel="noopener noreferrer"
                       className="mt-4 inline-flex min-h-[44px] items-center btn-plate-ink px-4 text-xs font-bold">
                        Strava profile
                    </a>
                )}
        </OverlaySheet>
    );
}

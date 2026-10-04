import React from "react";
import {ChevronRight} from "lucide-react";
import {useGetExpeditionByCompetitionQuery} from "../utils/reducers/competitionsSlice";
import {isChallengeRunning, lastChallenge} from "../utils/challenge";
import {ExpeditionRouteMap} from "./ExpeditionPanel";
import ProfileAvatar from "./ProfileAvatar";
import {DogTagRow} from "./gameBits";
import SeasonDrop from "./SeasonDrop";
import useWideLayout from "../utils/useWideLayout";

/** The running expedition Home should lead with. Prefers the rival card's challenge. */
export function pickSeasonChallenge(competitions, preferred) {
    const list = Array.isArray(competitions) ? competitions : Object.values(competitions || {});
    const running = list.filter((challenge) => isChallengeRunning(challenge) && challenge.expedition_enabled);
    if (!running.length) return null;
    if (preferred && running.some((challenge) => String(challenge.id) === String(preferred.id))) return preferred;
    return lastChallenge(running);
}

function shownPercent(value) {
    const number = Math.max(0, Math.min(100, Number(value) || 0));
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
}

// Identity first, route under it. Same wash, no second rectangle, no overlay.
export default function SeasonBoard({competitionId, user, onOpen}) {
    const wide = useWideLayout();
    const {data: expedition, isLoading} = useGetExpeditionByCompetitionQuery(competitionId, {skip: !competitionId});
    // A fresh log redraws the route so the save is seen landing on the trail.
    const [drawKey, setDrawKey] = React.useState(0);
    React.useEffect(() => {
        const onLogged = () => setDrawKey((k) => k + 1);
        window.addEventListener("wc:logged", onLogged);
        return () => window.removeEventListener("wc:logged", onLogged);
    }, []);
    if (!competitionId) return null;
    if (isLoading && !expedition) {
        return <div aria-hidden="true" className="season-bleed mb-4 min-h-72 animate-pulse"/>;
    }
    if (!expedition?.enabled || !Array.isArray(expedition.milestones)) return null;

    const progress = Math.max(0, Math.min(100, Number(expedition.progress_percent) || 0));
    const title = expedition.route_title || expedition.objective_title || "Expedition";
    const count = Number(expedition.participant_count) || 0;
    const percentLabel = shownPercent(progress);

    return (
        <>
            <SeasonDrop/>
            <button
                aria-label={`Open the trail: ${title}, ${percentLabel}%`}
                className="season-bleed mb-0 block overflow-hidden pb-5 text-left text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt-400"
                onClick={onOpen}
                type="button"
            >
                {/* Percent stays the hero number, but not at text-6xl: on a
                    ~390px phone that width truncated the name and squeezed
                    dog tags into a one-word column that stacked onto the trail. */}
                <div className="flex items-center gap-3 px-5 pt-6 sm:pt-7 md:gap-4">
                    <ProfileAvatar className="shrink-0" size={52} user={user}/>
                    <div className="min-w-0 flex-1 md:flex-none md:max-w-[16rem]">
                        <p className="t-pane text-white/55">{title}</p>
                        <h1 className="t-hero truncate">{user?.first_name}</h1>
                    </div>
                    <p className="shrink-0 font-display text-5xl leading-none tabular-nums text-volt-400 sm:text-6xl">{percentLabel}%</p>
                </div>
                {Array.isArray(user?.dog_tags) && user.dog_tags.length > 0 && (
                    <div className="px-5 pt-3">
                        <DogTagRow tags={user.dog_tags}/>
                    </div>
                )}
                <div className="mt-5 sm:mt-4 md:mt-3">
                    {/* Phone keeps the intrinsic trail. On the short fold the
                        same art is stretched across the hero so it is not a
                        small graphic floating under the name. */}
                    <ExpeditionRouteMap expedition={expedition} fillWidth={wide} key={drawKey} progress={progress} stage/>
                </div>
                <div className="flex items-center justify-between px-5 pb-1 pt-2">
                    <span className="text-sm text-white/80">{count} on the trail</span>
                    <ChevronRight aria-hidden="true" className="h-5 w-5 text-white/60"/>
                </div>
            </button>
        </>
    );
}

import React, {useMemo} from "react";
import {Link} from "react-router-dom";
import {Megaphone, ChevronRight, Radio} from "lucide-react";
import {PageWrapper} from "../utils/miscellaneous";

import {SectionLoader} from "../utils/loaders";
import PersonaAvatar from "../components/PersonaAvatar";
import PhotoPost from "../components/PhotoPost";
import RoastSwipeBox from "../components/RoastSwipeBox";
import CoachVoteBox from "../components/CoachVoteBox";
import PushOptInCard from "../components/PushOptIn";
import {useGetPersonasQuery, useGetDrillConfigsQuery, useGetDrillMessagesQuery, useGetHallOfRoastsQuery} from "../utils/reducers/drillInstructorSlice";
import {HallOfRoasts, MOOD_CHIP, OrderCard, SquadOrbit} from "../components/gameBits";
import {useGetCompetitionsQuery} from "../utils/reducers/competitionsSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import {timeAgo} from "../utils/time";
import usePollingInterval from "../utils/usePollingInterval";

// ---------------------------------------------------------------------------
// The Coach page: the Drill Instructor as the heart of the app.
// Hero persona card, order of the day, hot-or-not, hall of roasts, pings.
// Single column, mobile-first. The persona roaster lives under Settings.
// ---------------------------------------------------------------------------

const FALLBACK_PERSONA = {name: "Your Coach", tagline: "Waiting for orders.", avatar: "megaphone", theme_color: "#d7ff3e"};


function CoachHero({persona, config, latestMessage, ownedCompetitions, mood, userId}) {
    const ownActivity = Boolean(
        config?.enabled
        && latestMessage?.kind === "activity"
        && userId
        && latestMessage.workout_user_id === userId
    );
    return (
        <div className="relative overflow-hidden rounded-3xl glass-card text-ink-950 dark:text-white">
            {/* volt aura */}
            <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full blur-3xl"
                 style={{background: persona.theme_color || "#d7ff3e",
                         opacity: 0.18 + 0.12 * (mood?.intensity ?? 1)}}/>
            <div className="relative p-5 sm:p-8">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-volt-700 dark:text-volt-400">
                        <Radio className="h-3.5 w-3.5"/>
                        {config ? "On duty" : "Drill Instructor"}
                    </span>
                    {config && mood?.label && (
                        <span className={"rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.16em] " +
                            (MOOD_CHIP[mood.key] || "bg-gray-200 text-gray-700 dark:bg-ink-800 dark:text-gray-300")}>
                            {mood.label}
                        </span>
                    )}
                </div>

                <div className="mt-5 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
                    <SquadOrbit mood={mood}>
                        <div className="animate-float-slow">
                            <PersonaAvatar persona={persona} size={80} glow className="sm:!w-[92px] sm:!h-[92px]"/>
                        </div>
                    </SquadOrbit>
                    <div className="min-w-0 w-full">
                        <h1 className="font-display text-[1.35rem] sm:text-3xl uppercase leading-tight break-words">{persona.name}</h1>
                        {persona.tagline && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 italic break-words">“{persona.tagline}”</p>}
                    </div>
                </div>

                {/* speech bubble */}
                <div className="relative mt-6 rounded-2xl glass-inset px-5 py-4 animate-pop-in">
                    <div className="absolute -top-2 left-12 h-4 w-4 rotate-45 glass-inset"/>
                    {latestMessage ? (
                        <>
                            {/* Photo posts carry their text in the caption -
                                with an empty caption the bubble announces
                                the photo instead of rendering blank. */}
                            <p className="text-[15px] leading-relaxed break-words">
                                {latestMessage.kind === "photo"
                                    ? (latestMessage.body || `${latestMessage.author_name || "Someone"} shared a photo in the feed.`)
                                    : latestMessage.body}
                            </p>
                            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                                {latestMessage.kind === "photo" && latestMessage.author_name ? `${latestMessage.author_name} · ` : ""}
                                {latestMessage.competition_name} · {timeAgo(latestMessage.posted_at)}
                            </p>
                        </>
                    ) : config ? (
                        <p className="text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
                            Standing by. Log a workout in <b>{config.competition_name || "your challenge"}</b> and the coach will have words.
                        </p>
                    ) : (
                        <p className="text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
                            No coach assigned yet. {ownedCompetitions.length > 0
                                ? "Pick a persona and unleash them on your challenge."
                                : "Once your challenge's organizer enables the Drill Instructor, the banter lands here."}
                        </p>
                    )}
                </div>

                {ownActivity && (
                    <div className="mt-5">
                        <PhotoPost
                            competitionId={config.competition}
                            parentId={latestMessage.id}
                            visionCapable={Boolean(config.vision_capable)}
                            variant="pill"
                            label="Add a photo"
                        />
                    </div>
                )}

                {!config && ownedCompetitions.length > 0 && (
                    <Link to={`/competition/${ownedCompetitions[0].id}?tab=feed`}
                          className="mt-5 inline-flex items-center gap-2 rounded-full bg-volt-400 text-ink-950 px-5 py-2.5 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt">
                        <Megaphone className="h-4 w-4"/> Set up your coach <ChevronRight className="h-4 w-4"/>
                    </Link>
                )}
            </div>
        </div>
    );
}


function CoachPage() {
    const pollFast = usePollingInterval(60000);
    const {data: user, isLoading: userLoading} = useGetUserByIdQuery('me');
    const {data: configs, isLoading: configsLoading} = useGetDrillConfigsQuery();
    const {data: personas, isLoading: personasLoading} = useGetPersonasQuery();
    const {data: competitions} = useGetCompetitionsQuery();
    const {data: messages} = useGetDrillMessagesQuery(undefined, {pollingInterval: pollFast});
    const {data: hall} = useGetHallOfRoastsQuery(undefined, {pollingInterval: pollFast});

    const isLoading = userLoading || configsLoading || personasLoading;

    const {heroPersona, heroConfig, latestMessage} = useMemo(() => {
        const active = (configs || []).filter((c) => c.enabled);
        const sorted = [...active].sort((a, b) => new Date(b.last_posted_at || 0) - new Date(a.last_posted_at || 0));
        const cfg = sorted[0] || null;
        const persona = cfg?.persona_detail
            || (personas || []).find((p) => p.name === "Drill Sergeant")
            || (personas || [])[0]
            || FALLBACK_PERSONA;
        const latest = cfg ? (messages || []).find((m) => m.config === cfg.id) : (messages || [])[0];
        return {heroPersona: persona, heroConfig: cfg, latestMessage: latest || null};
    }, [configs, personas, messages]);

    const ownedCompetitions = useMemo(() => {
        if (!competitions || !user) return [];
        return Object.values(competitions).filter((c) => c.owner === user.id);
    }, [competitions, user]);

    return (
        <PageWrapper>
            <div className="container mx-auto max-w-3xl">
                {isLoading ? (
                    <SectionLoader height="h-96"/>
                ) : (
                    <div className="flex flex-col gap-4">
                        <CoachHero persona={heroPersona} config={heroConfig} latestMessage={latestMessage}
                                   ownedCompetitions={ownedCompetitions}
                                   mood={heroConfig?.mood}
                                   userId={user?.id}/>

                        {heroConfig?.daily_order && <OrderCard order={heroConfig.daily_order}/>}

                        {/* Hot-or-not over the coach's roasted photos.
                            Hidden when there is nothing left to vote on. */}
                        <RoastSwipeBox/>

                        <HallOfRoasts cards={hall}/>

                        <CoachVoteBox configs={configs} preferredConfigId={heroConfig?.id}/>

                        <PushOptInCard/>
                    </div>
                )}
            </div>
        </PageWrapper>
    );
}

export default CoachPage;

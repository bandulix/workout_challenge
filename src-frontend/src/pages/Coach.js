import React, {useMemo} from "react";
import {Link} from "react-router-dom";
import {Megaphone, ChevronRight, Radio} from "lucide-react";
import {PageWrapper} from "../utils/miscellaneous";

import {SectionLoader} from "../utils/loaders";
import PersonaAvatar from "../components/PersonaAvatar";
import RoastSwipeBox from "../components/RoastSwipeBox";
import CoachVoteBox from "../components/CoachVoteBox";
import PushOptInCard from "../components/PushOptIn";
import {ActivityCoachPost} from "../components/competitionChrome";
import {useGetPersonasQuery, useGetDrillConfigsQuery, useGetDrillMessagesQuery, useGetHallOfRoastsQuery} from "../utils/reducers/drillInstructorSlice";
import {HallOfRoasts, MOOD_CHIP, OrderCard, SquadOrbit, trainedSummary} from "../components/gameBits";
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

const KIND_LABEL = {
    activity: "Workout",
    push: "Ping",
    nudge: "Nudge",
    photo: "Photo",
    order: "Order",
    test: "Preview",
    dunce: "Dunce",
    handover: "Handover",
    sigh: "Missed",
    echo: "Echo",
    claim: "Claimed",
    war: "War",
};


function CoachQuote({message, empty}) {
    const body = message
        ? (message.kind === "photo"
            ? (message.body || `${message.author_name || "Someone"} shared a photo in the feed.`)
            : message.body)
        : null;
    const kind = message ? (KIND_LABEL[message.kind] || "Latest") : null;
    const who = message
        ? (message.kind === "photo" ? message.author_name : message.athlete_name)
        : null;
    const meta = message
        ? [who, message.competition_name, timeAgo(message.posted_at)].filter(Boolean).join(" · ")
        : null;

    return (
        <blockquote className="coach-quote relative mt-6 rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-pop-in">
            {body ? (
                <>
                    <p className="relative flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-volt-700 dark:text-volt-400">
                            {kind}
                        </span>
                        {meta && (
                            <span className="text-[11px] text-gray-500 dark:text-gray-400">{meta}</span>
                        )}
                    </p>
                    <p className="relative mt-2.5 text-[15px] sm:text-[1.05rem] leading-relaxed break-words">
                        {body}
                    </p>
                </>
            ) : (
                <div className="relative">{empty}</div>
            )}
        </blockquote>
    );
}


function CoachHero({persona, config, message: latest, ownedCompetitions, mood, lastOwnActivityId}) {
    const trained = trainedSummary(mood);
    return (
        <div className="relative rounded-3xl glass-card text-ink-950 dark:text-white">
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl" aria-hidden="true">
                <div className="absolute -top-24 -right-16 h-64 w-64 rounded-full blur-3xl"
                     style={{background: persona.theme_color || "#d7ff3e",
                             opacity: 0.18 + 0.12 * (mood?.intensity ?? 1)}}/>
            </div>
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
                    {trained && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-gray-600 dark:text-gray-300"
                              title={trained.hint}>
                            {trained.label}
                        </span>
                    )}
                </div>

                <div className="mt-4 flex items-center gap-3 sm:gap-5">
                    <SquadOrbit mood={mood} showCaption={false}>
                        <PersonaAvatar persona={persona} size={80} ring={false} glow={false}
                                       className="!w-full !h-full"/>
                    </SquadOrbit>
                    <div className="min-w-0 flex-1">
                        <h1 className="font-display text-[1.35rem] sm:text-3xl uppercase leading-tight break-words">{persona.name}</h1>
                        {persona.tagline && <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300 italic break-words">“{persona.tagline}”</p>}
                    </div>
                </div>

                {latest?.kind === "activity" ? (
                    <div className="mt-8">
                        <ActivityCoachPost
                            message={latest}
                            persona={{
                                avatar: latest.persona_avatar || persona.avatar,
                                profile_picture: latest.persona_profile_picture || persona.profile_picture,
                                theme_color: latest.persona_theme_color || persona.theme_color,
                                name: latest.persona_name || persona.name,
                            }}
                            canReply={Boolean(config?.enabled)}
                            competitionId={config.competition}
                            visionCapable={Boolean(config.vision_capable)}
                            lastOwnActivityId={lastOwnActivityId}
                            hero
                        />
                    </div>
                ) : (
                    <CoachQuote
                        message={latest}
                        empty={config ? (
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
                    />
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

    const {heroPersona, heroConfig, latestMessage, lastOwnActivityId} = useMemo(() => {
        const active = (configs || []).filter((c) => c.enabled);
        const sorted = [...active].sort((a, b) => new Date(b.last_posted_at || 0) - new Date(a.last_posted_at || 0));
        const cfg = sorted[0] || null;
        const persona = cfg?.persona_detail
            || (personas || []).find((p) => p.name === "Drill Sergeant")
            || (personas || [])[0]
            || FALLBACK_PERSONA;
        const mine = (cfg
            ? (messages || []).filter((m) => m.config === cfg.id)
            : (messages || []))
            .slice()
            .sort((a, b) => new Date(b.posted_at || 0) - new Date(a.posted_at || 0));
        const own = (user?.id
            ? mine.filter((m) => m.kind === "activity" && m.workout_user_id === user.id)
            : [])[0] || null;
        return {
            heroPersona: persona,
            heroConfig: cfg,
            latestMessage: mine[0] || null,
            lastOwnActivityId: own?.id || null,
        };
    }, [configs, personas, messages, user?.id]);

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
                        <CoachHero persona={heroPersona} config={heroConfig} message={latestMessage}
                                   ownedCompetitions={ownedCompetitions}
                                   mood={heroConfig?.mood}
                                   lastOwnActivityId={lastOwnActivityId}/>

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

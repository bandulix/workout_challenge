import React, {useEffect, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {Megaphone, ChevronRight, Radio, ScrollText} from "lucide-react";
import {PageWrapper} from "../utils/miscellaneous";

import {SectionLoader} from "../utils/loaders";
import PersonaAvatar from "../components/PersonaAvatar";
import CoachVoteBox, {CoachHandover} from "../components/CoachVoteBox";
import PushOptInCard from "../components/PushOptIn";
import {ActivityCoachPost} from "../components/competitionChrome";
import {messageResults, useGetPersonasQuery, useGetDrillConfigsQuery, useGetDrillMessagesQuery, useGetHallOfRoastsQuery} from "../utils/reducers/drillInstructorSlice";
import {HallOfRoasts, OrderCard, SquadOrbit, trainedSummary} from "../components/gameBits";
import {useGetCompetitionsQuery} from "../utils/reducers/competitionsSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import {timeAgo} from "../utils/time";
import usePollingInterval from "../utils/usePollingInterval";
import useWideLayout from "../utils/useWideLayout";
import {feedSfxItems, hallSfxItems, useSfxObserver} from "../utils/sfx";
import {PaneHead} from "../components/uiBits";

// ---------------------------------------------------------------------------
// The Coach page: the Drill Instructor as the heart of the app.
// Hero persona card, order of the day, hot-or-not, hall of roasts, pings.
// Single column, mobile-first. The persona roaster lives under Settings.
// ---------------------------------------------------------------------------

const FALLBACK_PERSONA = {name: "Your Coach", tagline: "Waiting for orders.", avatar: "megaphone", theme_color: "#d7ff3e"};

// Mood is carried by the portrait ring, not a word chip.
const MOOD_RING = {
    unleashed: "#d7ff3e",
    proud: "#b8e62e",
    watching: "#fbbf24",
    disappointed: "#f87171",
};

const KIND_LABEL = {
    activity: "Workout",
    push: "Ping",
    nudge: "Nudge",
    photo: "Photo",
    order: "Order",
    briefing: "Briefing",
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
        <blockquote className="coach-quote relative rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-pop-in">
            {body ? (
                <>
                    <p className="relative flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-gray-500 dark:text-white/55">
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


function coachPersona(persona, message) {
    return {
        avatar: message?.persona_avatar || persona.avatar,
        profile_picture: message?.persona_profile_picture || persona.profile_picture,
        theme_color: message?.persona_theme_color || persona.theme_color,
        name: message?.persona_name || persona.name,
    };
}


function CoachHero({persona, config, message: latest, briefing, ownedCompetitions, mood, lastOwnActivityId, meId}) {
    const trained = trainedSummary(mood);

    function activityCard(message, hero) {
        return (
            <ActivityCoachPost
                message={message}
                persona={coachPersona(persona, message)}
                canReply={Boolean(config?.enabled)}
                competitionId={config.competition}
                visionCapable={Boolean(config.vision_capable)}
                meId={meId}
                hero={hero}
            />
        );
    }

    const ringColor = MOOD_RING[mood?.key] || persona.theme_color || "#d7ff3e";
    return (
        <div className="season-bleed relative overflow-hidden pb-2 text-white">
            <div className="relative px-5 pt-7 sm:px-8">
                <div className="flex items-center gap-4 sm:gap-6">
                    <div className="relative shrink-0" title={mood?.label ? `${mood.label}${trained ? ` · ${trained.hint}` : ""}` : undefined}>
                        <SquadOrbit mood={mood} accent={ringColor} showCaption={false}>
                            <PersonaAvatar persona={persona} size={112} ring={false} glow={false}
                                           className="!w-full !h-full"/>
                        </SquadOrbit>
                        {mood?.label && <span className="sr-only">Mood: {mood.label}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="t-hero break-words xl:text-3xl">{persona.name}</h1>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                            <span className="inline-flex items-center gap-1.5" style={{color: ringColor}}>
                                <Radio className="h-3.5 w-3.5"/>{config ? "On duty" : "Coach"}
                            </span>
                            {trained && <span title={trained.hint}>· {trained.label}</span>}
                        </p>
                        {persona.tagline && <p className="mt-2 break-words text-sm italic text-white/70">“{persona.tagline}”</p>}
                    </div>
                </div>
            </div>

            <div className="relative space-y-4 px-5 pb-2 sm:px-8">
                    {latest?.kind === "activity" && config ? (
                        activityCard(latest, latest?.id === lastOwnActivityId)
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
                                        ? "Pick a coach and unleash them on your challenge."
                                        : "Once your challenge's organizer enables the coach, the banter lands here."}
                                </p>
                            )}
                        />
                    )}
                    {briefing && briefing.id !== latest?.id && (
                        <div className="rounded-2xl glass-well px-5 py-4 animate-pop-in">
                            <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-gray-500 dark:text-white/55">
                                <ScrollText className="h-3.5 w-3.5"/> Daily briefing
                            </p>
                            <p className="mt-2 text-[14px] leading-relaxed break-words text-gray-800 dark:text-gray-200">
                                {briefing.body}
                            </p>
                        </div>
                    )}

                    {!config && ownedCompetitions.length > 0 && (
                        <Link to={`/competition/${ownedCompetitions[0].id}?tab=feed&coach=setup`}
                              className="mt-5 inline-flex items-center gap-2 rounded-full bg-volt-400 px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink-950 shadow-glow-volt transition hover:bg-volt-300">
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
    const heroConfigId = useMemo(() => {
        const active = (configs || []).filter((c) => c.enabled);
        const sorted = [...active].sort((a, b) => new Date(b.last_posted_at || 0) - new Date(a.last_posted_at || 0));
        return sorted[0]?.competition || null;
    }, [configs]);
    const {data: messagesPage} = useGetDrillMessagesQuery(
        // 30, not 15: the pinned daily briefing must stay findable even on
        // a busy day with many activity posts pushing it down the list.
        {competition: heroConfigId, limit: 30, offset: 0},
        {pollingInterval: pollFast, skip: !heroConfigId},
    );
    const messages = messageResults(messagesPage);
    const [mediaReady, setMediaReady] = useState(false);
    useEffect(() => {
        const id = window.setTimeout(() => setMediaReady(true), 0);
        return () => window.clearTimeout(id);
    }, []);
    const {data: hall} = useGetHallOfRoastsQuery(undefined, {
        pollingInterval: pollFast,
        skip: !mediaReady,
    });
    useSfxObserver(`coach-feed:${heroConfigId || "none"}`, feedSfxItems(messages), Boolean(messagesPage));
    useSfxObserver("hall", hallSfxItems(hall), hall !== undefined);

    const isLoading = userLoading || configsLoading || personasLoading;

    const {heroPersona, heroConfig, latestMessage, todayBriefing, lastOwnActivityId} = useMemo(() => {
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
        // The owner's daily briefing is pinned under the hero - but only
        // while it is "of the day" (local calendar date), not forever.
        const today = new Date().toDateString();
        const briefing = mine.find((m) =>
            m.kind === "briefing" && new Date(m.posted_at || 0).toDateString() === today) || null;
        return {
            heroPersona: persona,
            heroConfig: cfg,
            latestMessage: mine[0] || null,
            todayBriefing: briefing,
            lastOwnActivityId: own?.id || null,
        };
    }, [configs, personas, messages, user?.id]);

    const ownedCompetitions = useMemo(() => {
        if (!competitions || !user) return [];
        return Object.values(competitions).filter((c) => c.owner === user.id);
    }, [competitions, user]);

    const wide = useWideLayout();

    return (
        <PageWrapper>
            {isLoading ? (
                <div className="container mx-auto p-4"><SectionLoader height="h-96"/></div>
            ) : (
                <>
                    <CoachHero persona={heroPersona} config={heroConfig} message={latestMessage}
                               briefing={todayBriefing}
                               ownedCompetitions={ownedCompetitions}
                               mood={heroConfig?.mood}
                               lastOwnActivityId={lastOwnActivityId}
                               meId={user?.id}/>
                    <div className="container mx-auto max-w-3xl p-4 md:max-w-6xl">
                        {wide ? (
                            <div className="grid grid-cols-2 items-start gap-4 stagger-in">
                                <div className="flex flex-col gap-4 stagger-in">
                                    {heroConfig && <CoachHandover configId={heroConfig.id} enabled={heroConfig.enabled}/>}
                                    {heroConfig?.daily_order && <OrderCard order={heroConfig.daily_order}/>}
                                </div>
                                <div className="flex flex-col gap-4 stagger-in">
                                    <CoachVoteBox configs={configs} preferredConfigId={heroConfig?.id}/>
                                    {mediaReady && <HallOfRoasts cards={hall} persona={heroPersona}/>}
                                    <PushOptInCard/>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4 stagger-in">
                                {heroConfig && <CoachHandover configId={heroConfig.id} enabled={heroConfig.enabled}/>}
                                {heroConfig?.daily_order && <OrderCard order={heroConfig.daily_order}/>}
                                <CoachVoteBox configs={configs} preferredConfigId={heroConfig?.id}/>
                                {mediaReady && <HallOfRoasts cards={hall} persona={heroPersona}/>}
                                <PushOptInCard/>
                            </div>
                        )}
                    </div>
                </>
            )}
        </PageWrapper>
    );
}

export default CoachPage;

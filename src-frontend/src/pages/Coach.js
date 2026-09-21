import React, {useEffect, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {Megaphone, ChevronRight, Radio, ScrollText, Volume2, VolumeX} from "lucide-react";
import {PageWrapper} from "../utils/miscellaneous";

import {SectionLoader} from "../utils/loaders";
import PersonaAvatar, {usePersonaImageSrc} from "../components/PersonaAvatar";
import PortraitWash from "../components/PortraitWash";
import CoachVoteBox, {CoachHandover} from "../components/CoachVoteBox";
import PushOptInCard from "../components/PushOptIn";
import {ActivityCoachPost} from "../components/competitionChrome";
import {messageResults, useGetPersonasQuery, useGetDrillConfigsQuery, useGetDrillMessagesQuery, useGetHallOfRoastsQuery} from "../utils/reducers/drillInstructorSlice";
import {HallOfRoasts, MOOD_CHIP, OrderCard, SquadOrbit, trainedSummary} from "../components/gameBits";
import {useGetCompetitionsQuery} from "../utils/reducers/competitionsSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import {timeAgo} from "../utils/time";
import usePollingInterval from "../utils/usePollingInterval";
import useWideLayout from "../utils/useWideLayout";
import {feedSfxItems, hallSfxItems, playSfx, useSfxEnabled, useSfxObserver} from "../utils/sfx";
import {PaneHead} from "../components/uiBits";

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


function coachPersona(persona, message) {
    return {
        avatar: message?.persona_avatar || persona.avatar,
        profile_picture: message?.persona_profile_picture || persona.profile_picture,
        theme_color: message?.persona_theme_color || persona.theme_color,
        name: message?.persona_name || persona.name,
    };
}


function CoachHeroWash({persona, mood}) {
    const {src, onError} = usePersonaImageSrc(persona);
    return (
        <PortraitWash
            src={src}
            color={persona?.theme_color || "#d7ff3e"}
            intensity={mood?.intensity}
            onError={onError}
        />
    );
}

function CoachHero({persona, config, message: latest, briefing, ownedCompetitions, mood, lastOwnActivityId}) {
    const trained = trainedSummary(mood);
    const [sfxOn, setSfxOn] = useSfxEnabled();

    function activityCard(message, hero) {
        return (
            <ActivityCoachPost
                message={message}
                persona={coachPersona(persona, message)}
                canReply={Boolean(config?.enabled)}
                competitionId={config.competition}
                visionCapable={Boolean(config.vision_capable)}
                lastOwnActivityId={lastOwnActivityId}
                hero={hero}
            />
        );
    }

    return (
        <div className="relative rounded-3xl glass-card portrait-wash-card text-ink-950 dark:text-white">
            <CoachHeroWash persona={persona} mood={mood}/>
            <div className="relative p-5 sm:p-8">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-volt-700 dark:text-volt-400">
                        <Radio className="h-3.5 w-3.5"/>
                        {config ? "On duty" : "Coach"}
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
                    {/* Explicit sound control - the avatar is decoration, not
                        a secret button (it gates ALL app SFX + the MIDI bed). */}
                    <button type="button"
                            onClick={() => {
                                const next = !sfxOn;
                                setSfxOn(next);
                                if (next) playSfx("vote");
                            }}
                            aria-pressed={sfxOn}
                            title="All app sounds and the coach music bed"
                            className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-full btn-glass px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 transition">
                        {sfxOn ? <Volume2 className="h-4 w-4"/> : <VolumeX className="h-4 w-4"/>}
                        {sfxOn ? "Sound on" : "Sound off"}
                    </button>
                </div>

                <div className="mt-4 flex items-center gap-3 sm:gap-5">
                    <div className="relative shrink-0">
                        <SquadOrbit mood={mood} accent={persona.theme_color} showCaption={false}>
                            <PersonaAvatar persona={persona} size={80} ring={false} glow={false}
                                           className="!w-full !h-full"/>
                        </SquadOrbit>
                    </div>
                    <div className="min-w-0 flex-1">
                        {/* Big headline only at xl: in the md two-pane
                            column (~400px) text-3xl wraps long coach
                            names mid-word ("SERGEAN T"). */}
                        <h1 className="t-hero xl:text-3xl break-words">{persona.name}</h1>
                        {persona.tagline && <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300 italic break-words">“{persona.tagline}”</p>}
                    </div>
                </div>

                <div className="mt-8 space-y-4">
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
                    {/* The owner's daily briefing (config.daily_prompt turned
                        into a coach post each morning) stays pinned under the
                        latest message for the rest of the day - unless it IS
                        the latest message, then the quote above already is it. */}
                    {briefing && briefing.id !== latest?.id && (
                        <div className="rounded-2xl glass-well px-5 py-4 animate-pop-in">
                            <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-volt-700 dark:text-volt-400">
                                <ScrollText className="h-3.5 w-3.5"/> Daily briefing
                            </p>
                            <p className="mt-2 text-[14px] leading-relaxed break-words text-gray-800 dark:text-gray-200">
                                {briefing.body}
                            </p>
                        </div>
                    )}
                </div>

                {!config && ownedCompetitions.length > 0 && (
                    /* coach=setup auto-opens the coach config modal on the
                       challenge page - no hunting for the megaphone icon. */
                    <Link to={`/competition/${ownedCompetitions[0].id}?tab=feed&coach=setup`}
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
            <div className="container mx-auto max-w-3xl md:max-w-6xl">
                {isLoading ? (
                    <SectionLoader height="h-96"/>
                ) : (() => {
                    const main = (
                        <>
                            <CoachHero persona={heroPersona} config={heroConfig} message={latestMessage}
                                       briefing={todayBriefing}
                                       ownedCompetitions={ownedCompetitions}
                                       mood={heroConfig?.mood}
                                       lastOwnActivityId={lastOwnActivityId}/>

                            {/* The handover celebration belongs where the voting
                                happens, not only on the challenge feed. */}
                            {heroConfig && <CoachHandover configId={heroConfig.id} enabled={heroConfig.enabled}/>}

                            {heroConfig?.daily_order && <OrderCard order={heroConfig.daily_order}/>}
                        </>
                    );
                    const play = (
                        <>
                            <CoachVoteBox configs={configs} preferredConfigId={heroConfig?.id}/>

                            {mediaReady && <HallOfRoasts cards={hall} persona={heroPersona}/>}

                            <PushOptInCard/>
                        </>
                    );
                    // lg+: the coach briefs on the left, the games live
                    // on the right - one glance, no scrolling.
                    if (wide) {
                        return (
                            <div className="grid grid-cols-2 gap-4 items-start stagger-in">
                                <div className="flex flex-col gap-4 stagger-in">{main}</div>
                                <div className="flex flex-col gap-4 stagger-in">{play}</div>
                            </div>
                        );
                    }
                    return <div className="flex flex-col gap-4 stagger-in">{main}{play}</div>;
                })()}
            </div>
        </PageWrapper>
    );
}

export default CoachPage;

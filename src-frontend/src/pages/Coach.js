import React, {useEffect, useMemo, useRef, useState} from "react";
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
const WHEEL_SIZE = 5;


function HeroMessageBody({message}) {
    if (!message) return null;
    return (
        <>
            <p className="text-[15px] leading-relaxed break-words">
                {message.kind === "photo"
                    ? (message.body || `${message.author_name || "Someone"} shared a photo in the feed.`)
                    : message.body}
            </p>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {message.kind === "photo" && message.author_name ? `${message.author_name} · ` : ""}
                {message.competition_name} · {timeAgo(message.posted_at)}
            </p>
        </>
    );
}


function MessageWheel({messages, empty}) {
    const list = messages || [];
    const n = list.length;
    const scrollerRef = useRef(null);
    const [idx, setIdx] = useState(0);

    useEffect(() => {
        setIdx(0);
        scrollerRef.current?.scrollTo({left: 0});
    }, [list[0]?.id]);

    function syncIndex(scroller) {
        const slides = scroller.children;
        let best = 0;
        let bestDist = Infinity;
        const left = scroller.scrollLeft;
        for (let i = 0; i < slides.length; i++) {
            const dist = Math.abs(slides[i].offsetLeft - left);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        setIdx((prev) => (prev === best ? prev : best));
    }

    function goTo(next) {
        const clamped = Math.max(0, Math.min(n - 1, next));
        const scroller = scrollerRef.current;
        const slide = scroller?.children[clamped];
        if (scroller && slide) {
            scroller.scrollTo({left: slide.offsetLeft, behavior: "smooth"});
        }
    }

    if (n === 0) return empty;

    return (
        <div className="mt-5">
            <div
                ref={scrollerRef}
                role="region"
                aria-roledescription="carousel"
                aria-label="Recent coach messages"
                tabIndex={n > 1 ? 0 : undefined}
                onScroll={(e) => syncIndex(e.currentTarget)}
                onKeyDown={(e) => {
                    if (n < 2) return;
                    if (e.key === "ArrowRight") { e.preventDefault(); goTo(idx + 1); }
                    else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(idx - 1); }
                }}
                className={"flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar overscroll-x-contain " +
                    (n > 1 ? "-mr-5 sm:-mr-8 pr-5 sm:pr-8" : "")}>
                {list.map((m, i) => (
                    <article
                        key={m.id}
                        aria-hidden={i !== idx}
                        className={"relative shrink-0 snap-start rounded-2xl glass-inset px-5 py-4 transition-opacity duration-300 " +
                            (n > 1 ? "w-[86%]" : "w-full") +
                            (i === idx ? "" : " opacity-50")}>
                        <div className="absolute -top-2 left-12 h-4 w-4 rotate-45 glass-inset"/>
                        <HeroMessageBody message={m}/>
                    </article>
                ))}
            </div>
            {n > 1 && (
                <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden="true">
                    {list.map((m, i) => (
                        <span key={m.id}
                              className={"h-1 rounded-full transition-all duration-300 " +
                                  (i === idx ? "w-4 bg-volt-400 shadow-glow-volt" : "w-1 bg-ink-950/20 dark:bg-white/20")}/>
                    ))}
                </div>
            )}
        </div>
    );
}


function CoachHero({persona, config, messages, ownedCompetitions, mood, userId}) {
    const latest = (messages || [])[0] || null;
    const ownActivity = Boolean(
        config?.enabled
        && latest?.kind === "activity"
        && userId
        && latest.workout_user_id === userId
    );
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

                <MessageWheel
                    messages={messages}
                    empty={
                        <div className="relative mt-6 rounded-2xl glass-inset px-5 py-4">
                            <div className="absolute -top-2 left-12 h-4 w-4 rotate-45 glass-inset"/>
                            {config ? (
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
                    }
                />

                {ownActivity && (
                    <div className="mt-5">
                        <PhotoPost
                            competitionId={config.competition}
                            parentId={latest.id}
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

    const {heroPersona, heroConfig, recentMessages} = useMemo(() => {
        const active = (configs || []).filter((c) => c.enabled);
        const sorted = [...active].sort((a, b) => new Date(b.last_posted_at || 0) - new Date(a.last_posted_at || 0));
        const cfg = sorted[0] || null;
        const persona = cfg?.persona_detail
            || (personas || []).find((p) => p.name === "Drill Sergeant")
            || (personas || [])[0]
            || FALLBACK_PERSONA;
        const mine = cfg
            ? (messages || []).filter((m) => m.config === cfg.id)
            : (messages || []);
        return {heroPersona: persona, heroConfig: cfg, recentMessages: mine.slice(0, WHEEL_SIZE)};
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
                        <CoachHero persona={heroPersona} config={heroConfig} messages={recentMessages}
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

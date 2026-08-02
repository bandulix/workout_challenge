import React, {useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {Megaphone, Bot, ChevronRight, Radio, Sparkles, PencilLine, Flag} from "lucide-react";
import {PageWrapper, BoxSection} from "../utils/miscellaneous";
import {SectionLoader} from "../utils/loaders";
import PersonaAvatar from "../components/PersonaAvatar";
import PushOptInCard from "../components/PushOptIn";
import {Modal} from "../forms/basicComponents";
import DrillInstructorPersonaModal from "../forms/drillInstructorPersonaModal";
import {useGetPersonasQuery, useGetDrillConfigsQuery, useGetDrillMessagesQuery} from "../utils/reducers/drillInstructorSlice";
import {useGetCompetitionsQuery} from "../utils/reducers/competitionsSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import {timeAgo} from "../utils/time";

// ---------------------------------------------------------------------------
// The Coach page: the Drill Instructor as the heart of the app.
// Hero persona card, "My challenges" jump-off block, push opt-in card and
// the persona roaster. Single column, mobile-first.
// ---------------------------------------------------------------------------

const FALLBACK_PERSONA = {name: "Your Coach", tagline: "Waiting for orders.", avatar: "megaphone", theme_color: "#d7ff3e"};


function CoachHero({persona, config, latestMessage, ownedCompetitions}) {
    return (
        <div className="relative overflow-hidden rounded-3xl bg-ink-900 text-white shadow-card-dark border border-ink-700/60">
            {/* volt aura */}
            <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full opacity-25 blur-3xl"
                 style={{background: persona.theme_color || "#d7ff3e"}}/>
            <div className="relative p-6 sm:p-8">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-volt-400">
                    <Radio className="h-3.5 w-3.5"/>
                    {config ? "On duty" : "Drill Instructor"}
                </div>

                <div className="mt-5 flex items-center gap-5">
                    <div className="animate-float-slow">
                        <PersonaAvatar persona={persona} size={92} glow/>
                    </div>
                    <div className="min-w-0">
                        <h1 className="font-display text-2xl sm:text-3xl uppercase leading-none truncate">{persona.name}</h1>
                        {persona.tagline && <p className="mt-2 text-sm text-gray-300 italic">“{persona.tagline}”</p>}
                    </div>
                </div>

                {/* speech bubble */}
                <div className="relative mt-6 rounded-2xl bg-white/10 backdrop-blur px-5 py-4 animate-pop-in">
                    <div className="absolute -top-2 left-12 h-4 w-4 rotate-45 bg-white/10"/>
                    {latestMessage ? (
                        <>
                            <p className="text-[15px] leading-relaxed">{latestMessage.body}</p>
                            <p className="mt-2 text-xs text-gray-400">
                                {latestMessage.competition_name} · {timeAgo(latestMessage.posted_at)}
                            </p>
                        </>
                    ) : config ? (
                        <p className="text-[15px] leading-relaxed text-gray-300">
                            Standing by. Log a workout in <b>{config.competition_name || "your competition"}</b> and the coach will have words.
                        </p>
                    ) : (
                        <p className="text-[15px] leading-relaxed text-gray-300">
                            No coach assigned yet. {ownedCompetitions.length > 0
                                ? "Pick a persona and unleash them on your competition."
                                : "Once your competition's organizer enables the Drill Instructor, the banter lands here."}
                        </p>
                    )}
                </div>

                {!config && ownedCompetitions.length > 0 && (
                    <Link to={`/competition/${ownedCompetitions[0].id}`}
                          className="mt-5 inline-flex items-center gap-2 rounded-full bg-volt-400 text-ink-950 px-5 py-2.5 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt">
                        <Megaphone className="h-4 w-4"/> Set up your coach <ChevronRight className="h-4 w-4"/>
                    </Link>
                )}
            </div>
        </div>
    );
}


function challengeStatus(c) {
    const now = Date.now() / 1000;
    if (c.start_date_epoch && now < c.start_date_epoch) return {label: "Upcoming", classes: "bg-sky-400/15 text-sky-600 dark:text-sky-300"};
    if (c.end_date_epoch && now > c.end_date_epoch + 86400) return {label: "Finished", classes: "bg-gray-400/15 text-gray-500 dark:text-gray-400"};
    return {label: "Running", classes: "bg-volt-400/20 text-volt-700 dark:text-volt-300"};
}


function MyChallenges({competitions}) {
    return (
        <BoxSection>
            <h2 className="font-display text-sm uppercase tracking-wider flex items-center gap-2 mb-2">
                <Flag className="h-4 w-4 text-volt-500"/> My challenges
            </h2>
            {competitions.length === 0 ? (
                <p className="text-sm text-gray-400 px-2 py-3">
                    No challenges yet. Create or join one from the <Link to="/dashboard" className="font-semibold text-volt-600 dark:text-volt-300 hover:underline">Home page</Link>.
                </p>
            ) : (
                <ul className="divide-y divide-gray-100 dark:divide-ink-700/60">
                    {competitions.map((c) => {
                        const status = challengeStatus(c);
                        return (
                            <li key={c.id}>
                                <Link to={`/competition/${c.id}`}
                                      className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-2xl hover:bg-gray-50 dark:hover:bg-ink-800 transition min-h-[44px]">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold truncate">{c.name}</p>
                                        <p className="text-xs text-gray-400">{c.start_date_fmt} – {c.end_date_fmt}</p>
                                    </div>
                                    <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide " + status.classes}>
                                        {status.label}
                                    </span>
                                    <ChevronRight className="h-4 w-4 text-gray-400 shrink-0"/>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </BoxSection>
    );
}


function PersonaCard({persona, usedIn, onOpen}) {
    return (
        <button onClick={() => onOpen(persona)}
                className="group snap-start shrink-0 w-40 rounded-3xl bg-white dark:bg-ink-850 border border-gray-200/70 dark:border-ink-700/60 shadow-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-volt-500/80 dark:hover:border-volt-500/60 hover:shadow-card-dark">
            <PersonaAvatar persona={persona} size={64} className="mx-auto transition group-hover:scale-105"/>
            <p className="mt-3 text-center text-sm font-bold truncate">{persona.name}</p>
            <p className="text-center text-[11px] text-gray-400 truncate">{persona.tagline || persona.description}</p>
            {usedIn > 0 && (
                <p className="mt-2 text-center">
                    <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 px-2 py-0.5">
                        On duty ×{usedIn}
                    </span>
                </p>
            )}
        </button>
    );
}


function PersonaDetailModal({persona, isStaff, onClose}) {
    return (
        <Modal setShowModal={onClose} title={persona.name}>
            <div className="flex flex-col items-center text-center">
                <PersonaAvatar persona={persona} size={96} glow/>
                {persona.tagline && <p className="mt-3 text-sm italic text-gray-500 dark:text-gray-400">“{persona.tagline}”</p>}
                {persona.is_builtin && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                        <Sparkles className="h-3 w-3"/> Built-in persona
                    </span>
                )}
                <p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-gray-300 max-w-md">{persona.description}</p>
                {/* The voice & style briefing is admin-only (prompt-engineering know-how). */}
                {isStaff && persona.system_prompt && (
                    <div className="mt-5 w-full text-left">
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-2">Voice & style briefing</p>
                        <pre className="whitespace-pre-wrap rounded-2xl bg-gray-100 dark:bg-ink-900 dark:border dark:border-ink-700/60 p-4 text-xs leading-relaxed text-gray-600 dark:text-gray-300 max-h-56 overflow-y-auto">{persona.system_prompt}</pre>
                    </div>
                )}
            </div>
        </Modal>
    );
}


function CoachPage() {
    const {data: user, isLoading: userLoading} = useGetUserByIdQuery('me');
    const {data: configs, isLoading: configsLoading} = useGetDrillConfigsQuery();
    const {data: personas, isLoading: personasLoading} = useGetPersonasQuery();
    const {data: competitions} = useGetCompetitionsQuery();
    const {data: messages} = useGetDrillMessagesQuery(undefined, {pollingInterval: 60000});

    const [detailPersona, setDetailPersona] = useState(null);
    const [showPersonaManager, setShowPersonaManager] = useState(false);

    const isLoading = userLoading || configsLoading || personasLoading;
    const isStaff = !!user?.is_staff;

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

    const myCompetitions = useMemo(() => Object.values(competitions || {}), [competitions]);

    const ownedCompetitions = useMemo(() => {
        if (!competitions || !user) return [];
        return Object.values(competitions).filter((c) => c.owner === user.id);
    }, [competitions, user]);

    const usageByPersona = useMemo(() => {
        const counts = {};
        for (const c of configs || []) {
            if (c.enabled && c.persona) counts[c.persona] = (counts[c.persona] || 0) + 1;
        }
        return counts;
    }, [configs]);

    return (
        <PageWrapper>
            <div className="container mx-auto max-w-3xl">
                {isLoading ? (
                    <SectionLoader height="h-96"/>
                ) : (
                    <div className="flex flex-col gap-4">
                        <CoachHero persona={heroPersona} config={heroConfig} latestMessage={latestMessage}
                                   ownedCompetitions={ownedCompetitions}/>

                        <MyChallenges competitions={myCompetitions}/>

                        <PushOptInCard/>

                        <BoxSection>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="font-display text-sm uppercase tracking-wider flex items-center gap-2">
                                    <Bot className="h-4 w-4 text-volt-500"/> The roaster
                                </h2>
                                {/* Personas are managed by the admin only. */}
                                {isStaff && (
                                    <button onClick={() => setShowPersonaManager(true)}
                                            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-300 hover:text-volt-600 dark:hover:text-volt-300 transition">
                                        <PencilLine className="h-3.5 w-3.5"/> Manage
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x -mx-2 px-2 -my-3 py-3">
                                {(personas || []).map((p) => (
                                    <PersonaCard key={p.id} persona={p} usedIn={usageByPersona[p.id] || 0} onOpen={setDetailPersona}/>
                                ))}
                            </div>
                            <div className="mt-3 rounded-xl bg-gray-100 dark:bg-ink-900 dark:border dark:border-ink-700/60 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                                <span className="font-bold text-gray-600 dark:text-gray-300">Only challenge owners can pick a coach from the roaster</span> — via the AI Drill Instructor settings on their competition page. Tap a card to preview a persona.
                            </div>
                        </BoxSection>
                    </div>
                )}
            </div>

            {detailPersona && <PersonaDetailModal persona={detailPersona} isStaff={isStaff} onClose={() => setDetailPersona(null)}/>}
            {showPersonaManager && isStaff && <DrillInstructorPersonaModal setModalState={setShowPersonaManager}/>}
        </PageWrapper>
    );
}

export default CoachPage;

import React, {useMemo, useState} from "react";
import {PencilLine, Plus, Sparkles} from "lucide-react";
import PersonaAvatar from "./PersonaAvatar";
import {Modal} from "../forms/basicComponents";
import DrillInstructorPersonaModal, {PersonaEditModal} from "../forms/drillInstructorPersonaModal";
import {useGetPersonasQuery, useGetDrillConfigsQuery} from "../utils/reducers/drillInstructorSlice";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";

function PersonaCard({persona, usedIn, onOpen}) {
    return (
        <button onClick={() => onOpen(persona)}
                className="group min-w-0 rounded-3xl glass-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-volt-500/80">
            <PersonaAvatar persona={persona} size={64} className="mx-auto transition group-hover:scale-105"/>
            <p className="mt-3 text-center text-sm font-bold truncate">{persona.name}</p>
            <p className="text-center text-[11px] text-gray-400 truncate">{persona.tagline || persona.description}</p>
            <p className="mt-2 text-center min-h-[18px]">
                {persona.mine ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 px-2 py-0.5">
                        Yours
                    </span>
                ) : usedIn > 0 ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 px-2 py-0.5">
                        On duty ×{usedIn}
                    </span>
                ) : null}
            </p>
        </button>
    );
}

function PersonaDetail({persona, canEdit, onEdit}) {
    const showBriefing = Boolean(persona.system_prompt) && (canEdit || persona.mine);
    return (
        <div className="flex flex-col items-center text-center">
            <PersonaAvatar persona={persona} size={96} glow/>
            {persona.tagline && <p className="mt-3 text-sm italic text-gray-500 dark:text-gray-400">“{persona.tagline}”</p>}
            {persona.mine && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                    Your roaster
                </span>
            )}
            {persona.is_builtin && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                    <Sparkles className="h-3 w-3"/> Built-in persona
                </span>
            )}
            <p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-gray-300 max-w-md">{persona.description}</p>
            {showBriefing && (
                <div className="mt-5 w-full text-left">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-2">Voice & style briefing</p>
                    <pre className="whitespace-pre-wrap rounded-2xl glass-well p-4 text-xs leading-relaxed text-gray-700 dark:text-gray-300 max-h-56 overflow-y-auto">{persona.system_prompt}</pre>
                </div>
            )}
            {canEdit && (
                <button type="button" onClick={onEdit}
                        className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-volt-400 text-ink-950 px-4 py-2 text-xs font-bold uppercase tracking-wide hover:bg-volt-300 transition">
                    <PencilLine className="h-3.5 w-3.5"/> Edit
                </button>
            )}
        </div>
    );
}

export default function RoasterModal({setShowModal}) {
    const {data: user, isLoading: userLoading} = useGetUserByIdQuery("me");
    const {data: configs, isLoading: configsLoading} = useGetDrillConfigsQuery();
    const {data: personas, isLoading: personasLoading} = useGetPersonasQuery();

    const [detailPersona, setDetailPersona] = useState(null);
    const [showPersonaManager, setShowPersonaManager] = useState(false);
    const [editingPersona, setEditingPersona] = useState(null);

    const isStaff = !!user?.is_staff;
    const isLoading = userLoading || configsLoading || personasLoading;

    const usageByPersona = useMemo(() => {
        const counts = {};
        for (const c of configs || []) {
            if (c.enabled && c.persona) counts[c.persona] = (counts[c.persona] || 0) + 1;
        }
        return counts;
    }, [configs]);

    const roasterPersonas = useMemo(() => {
        const list = [...(personas || [])];
        list.sort((a, b) => {
            if (a.mine !== b.mine) return a.mine ? -1 : 1;
            if (a.is_builtin !== b.is_builtin) return a.is_builtin ? -1 : 1;
            return (a.name || "").localeCompare(b.name || "");
        });
        return list;
    }, [personas]);

    function canEditPersona(persona) {
        if (!persona) return false;
        if (isStaff) return true;
        return Boolean(persona.mine) && !persona.is_builtin;
    }

    if (showPersonaManager) {
        return <DrillInstructorPersonaModal setModalState={(open) => { if (open === false) setShowPersonaManager(false); }}/>;
    }
    if (editingPersona !== null) {
        return (
            <PersonaEditModal
                persona={editingPersona}
                setModalState={(open) => { if (open === false) setEditingPersona(null); }}
            />
        );
    }

    return (
        <Modal title={detailPersona ? detailPersona.name : "The roaster"} setShowModal={setShowModal} isLoading={isLoading}>
            {detailPersona ? (
                <>
                    <button type="button" onClick={() => setDetailPersona(null)}
                            className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-300 hover:text-volt-600 dark:hover:text-volt-300 transition">
                        ← Back to the roaster
                    </button>
                    <PersonaDetail
                        persona={detailPersona}
                        canEdit={canEditPersona(detailPersona)}
                        onEdit={() => {
                            setEditingPersona(detailPersona);
                            setDetailPersona(null);
                        }}
                    />
                </>
            ) : (
                <>
                    <div className="flex items-center justify-end">
                        <button type="button" onClick={() => setShowPersonaManager(true)}
                                className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-300 hover:text-volt-600 dark:hover:text-volt-300 transition">
                            <PencilLine className="h-3.5 w-3.5"/> Manage
                        </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {roasterPersonas.map((p) => (
                            <PersonaCard key={p.id} persona={p} usedIn={usageByPersona[p.id] || 0} onOpen={setDetailPersona}/>
                        ))}
                        <button type="button" onClick={() => setEditingPersona({})}
                                className="min-w-0 rounded-3xl border-2 border-dashed border-gray-300 dark:border-ink-600 bg-transparent p-4 text-center hover:border-volt-500 hover:bg-volt-400/10 transition">
                            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300">
                                <Plus className="h-7 w-7"/>
                            </span>
                            <p className="mt-3 text-sm font-bold">Create yours</p>
                            <p className="text-[11px] text-gray-400">A coach in your voice</p>
                        </button>
                    </div>
                    <div className="rounded-2xl glass-inset px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-bold text-gray-600 dark:text-gray-300">Anyone can add a roaster</span> — built-ins plus the ones you create. Challenge owners pick a coach from this list in the AI Drill Instructor settings on their challenge page.
                    </div>
                </>
            )}
        </Modal>
    );
}

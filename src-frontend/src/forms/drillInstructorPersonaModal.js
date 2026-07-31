import React, {useEffect, useState} from "react";
import {
    useAddPersonaMutation,
    useDeletePersonaMutation,
    useGetPersonasQuery,
    useUpdatePersonaMutation,
} from "../utils/reducers/drillInstructorSlice";
import {
    AddButton,
    DeleteButton,
    EditButton,
    Modal,
    SaveButton,
} from "./basicComponents";
import PersonaAvatar from "../components/PersonaAvatar";

// Artwork shipped in /public/personas - custom personas pick one of these
// (or type a single emoji) plus an accent colour.
export const PERSONA_ARTWORK = [
    "megaphone", "sergeant", "roast", "cheerleader", "butler", "zen",
    "rocket", "ninja", "robot", "captain",
];
export const PERSONA_COLORS = [
    "#d7ff3e", "#ff6b3d", "#ff5cb8", "#9fb4d8", "#4fd6c4",
    "#a78bfa", "#f43f5e", "#38bdf8", "#fbbf24", "#94a3b8",
];

function PersonaEditModal({persona, setModalState}) {
    const isNew = persona?.id === undefined;
    const [values, setValues] = useState({});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState("");

    const [addPersona, {isLoading: addLoading, error: addError, isSuccess: addSuccess}] = useAddPersonaMutation();
    const [updatePersona, {isLoading: updateLoading, error: updateError, isSuccess: updateSuccess}] = useUpdatePersonaMutation();

    useEffect(() => {
        if (persona) {
            setValues({
                name: persona.name || "",
                tagline: persona.tagline || "",
                description: persona.description || "",
                avatar: persona.avatar || "megaphone",
                theme_color: persona.theme_color || PERSONA_COLORS[0],
                system_prompt: persona.system_prompt || "",
            });
        }
    }, [persona]);

    useEffect(() => {
        if (addError) setFormError("Create Error: " + JSON.stringify(addError?.data || addError?.message));
        if (updateError) setFormError("Update Error: " + JSON.stringify(updateError?.data || updateError?.message));
    }, [addError, updateError]);

    useEffect(() => {
        if (addSuccess || updateSuccess) {
            setModalState(false);
            document.body.classList.remove("body-no-scroll");
        }
    }, [addSuccess, updateSuccess]);

    async function handleSubmit() {
        setFieldErrors({});
        setFormError("");
        const payload = {...values};
        try {
            if (isNew) {
                await addPersona(payload).unwrap();
            } else {
                await updatePersona({id: persona.id, ...payload}).unwrap();
            }
        } catch (err) {
            console.error("Persona save failed", err);
            setFieldErrors(err?.data || {});
        }
    }

    const inputClass = "w-full shadow border rounded-xl py-2 px-3 text-gray-700 dark:bg-ink-900 dark:text-gray-300 leading-tight focus:outline-none focus:border-volt-500";

    return (
        <Modal title={isNew ? "New Persona" : "Edit Persona"} setShowModal={setModalState} isLoading={addLoading || updateLoading}>
            {/* identity preview */}
            <div className="flex items-center gap-4 px-4 pb-2">
                <PersonaAvatar persona={values} size={72} glow/>
                <div>
                    <p className="font-bold">{values.name || "Unnamed coach"}</p>
                    <p className="text-sm text-gray-400 italic">{values.tagline || "No tagline yet."}</p>
                </div>
            </div>

            <div className="flex flex-wrap">
                <div className="px-4 w-full sm:w-1/2">
                    <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                        Name*{fieldErrors.name && <span className="text-red-600 font-normal italic"> ({fieldErrors.name})</span>}
                    </label>
                    <input type="text" className={inputClass} value={values.name || ""}
                           onChange={(e) => setValues({...values, name: e.target.value})}
                           autoFocus={!window.matchMedia("(max-width: 640px)").matches}/>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                        Tagline{fieldErrors.tagline && <span className="text-red-600 font-normal italic"> ({fieldErrors.tagline})</span>}
                    </label>
                    <input type="text" className={inputClass} value={values.tagline || ""} maxLength={80}
                           placeholder="e.g. No mercy. All love."
                           onChange={(e) => setValues({...values, tagline: e.target.value})}/>
                </div>
                <div className="px-4 w-full">
                    <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                        Short Description{fieldErrors.description && <span className="text-red-600 font-normal italic"> ({fieldErrors.description})</span>}
                    </label>
                    <input type="text" className={inputClass} value={values.description || ""}
                           placeholder="e.g. Tough-love military style"
                           onChange={(e) => setValues({...values, description: e.target.value})}/>
                </div>

                {/* avatar artwork picker */}
                <div className="px-4 w-full">
                    <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                        Profile Picture{fieldErrors.avatar && <span className="text-red-600 font-normal italic"> ({fieldErrors.avatar})</span>}
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {PERSONA_ARTWORK.map((key) => (
                            <button key={key} type="button" onClick={() => setValues({...values, avatar: key})}
                                    className={"rounded-full transition active:scale-90 " + (values.avatar === key ? "ring-2 ring-offset-2 ring-volt-400 dark:ring-offset-ink-850" : "opacity-60 hover:opacity-100")}>
                                <PersonaAvatar persona={{avatar: key, theme_color: values.theme_color}} size={44} ring={false}/>
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">…or type a single emoji:</p>
                    <input type="text" className={inputClass + " mt-1 w-24 text-center"} value={PERSONA_ARTWORK.includes(values.avatar) ? "" : values.avatar || ""}
                           placeholder="🔥" maxLength={8}
                           onChange={(e) => setValues({...values, avatar: e.target.value || "megaphone"})}/>
                </div>

                {/* accent colour picker */}
                <div className="px-4 w-full">
                    <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                        Accent Colour{fieldErrors.theme_color && <span className="text-red-600 font-normal italic"> ({fieldErrors.theme_color})</span>}
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {PERSONA_COLORS.map((c) => (
                            <button key={c} type="button" onClick={() => setValues({...values, theme_color: c})}
                                    className={"h-9 w-9 rounded-full transition active:scale-90 " + (values.theme_color === c ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-ink-850 scale-110" : "hover:scale-110")}
                                    style={{backgroundColor: c}}/>
                        ))}
                    </div>
                </div>

                <div className="px-4 w-full">
                    <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                        System Prompt (voice and style)*{fieldErrors.system_prompt && <span className="text-red-600 font-normal italic"> ({fieldErrors.system_prompt})</span>}
                    </label>
                    <textarea rows={8} className={inputClass} value={values.system_prompt || ""}
                              onChange={(e) => setValues({...values, system_prompt: e.target.value})}/>
                </div>
            </div>
            <div className="text-center text-red-500 text-xs italic">{formError}</div>
            <div className="relative flex justify-end items-center">
                <SaveButton onClick={handleSubmit} label={isNew ? "Create" : "Save"} highlighted={true} larger={true}/>
            </div>
        </Modal>
    );
}

export default function DrillInstructorPersonaModal({setModalState}) {
    const {data: personas, isLoading, refetch} = useGetPersonasQuery();
    const [deletePersona, {isLoading: deleteLoading}] = useDeletePersonaMutation();

    const [editing, setEditing] = useState(null);

    async function handleDelete(persona) {
        const confirmation = window.confirm(`Delete the persona "${persona.name}"?`);
        if (!confirmation) return;
        try {
            await deletePersona(persona.id).unwrap();
        } catch (err) {
            window.alert("Could not delete persona: " + JSON.stringify(err?.data || err?.message));
        }
    }

    return (
        <Modal title="AI Drill Instructor Personas" landscape={true} setShowModal={setModalState} isLoading={isLoading || deleteLoading}>
            <div className="text-sm text-gray-600 dark:text-gray-400 px-4 pb-2">
                Personas define the voice and style of the AI Drill Instructor. Any competition owner can pick
                any persona when configuring their Drill Instructor. Built-in personas can be edited but not deleted.
            </div>
            <div className="grid gap-2 sm:grid-cols-2 px-2">
                {(personas?.length ?? 0) === 0 ? (
                    <p className="py-2 px-4 text-center text-gray-500 sm:col-span-2">No personas yet - create the first one.</p>
                ) : (
                    personas.map((persona) => (
                        <div key={"persona" + persona.id}
                             className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-ink-700/60 p-3 hover:shadow-card transition">
                            <PersonaAvatar persona={persona} size={52}/>
                            <div className="min-w-0 flex-1">
                                <div className="font-bold truncate">{persona.name}{persona.is_builtin && (
                                    <span className="ml-2 text-[10px] uppercase tracking-wide text-volt-600 dark:text-volt-400 font-bold">built-in</span>
                                )}</div>
                                <div className="text-xs text-gray-400 italic truncate">{persona.tagline}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{persona.description}</div>
                            </div>
                            <div className="flex flex-col gap-1">
                                <EditButton additionalClasses="mx-1" onClick={() => setEditing(persona)} label={false} larger={true}/>
                                {!persona.is_builtin && (
                                    <DeleteButton additionalClasses="mx-1" onClick={() => handleDelete(persona)} label={false} larger={true}/>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
            <div className="relative flex justify-between items-center">
                <AddButton onClick={() => setEditing({})} label="New Persona" highlighted={true} larger={true}/>
                <button className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-volt-300" onClick={() => refetch()}>Refresh</button>
            </div>
            {editing !== null && (
                <PersonaEditModal persona={editing} setModalState={(open) => {
                    setEditing(null);
                    if (open === false) setModalState(false);
                }}/>
            )}
        </Modal>
    );
}

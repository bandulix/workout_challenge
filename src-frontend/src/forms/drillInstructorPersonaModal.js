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
import {SectionLoader} from "../utils/loaders";

const PERSONA_FIELDS = {
    name: {
        type: "text",
        required: true,
        read_only: false,
        label: "Name",
        width: "w-full",
        autoFocus: true,
    },
    description: {
        type: "text",
        required: false,
        read_only: false,
        label: "Short Description",
        width: "w-full",
        placeholder: "e.g. Tough-love military style",
    },
    system_prompt: {
        type: "textarea",
        required: true,
        read_only: false,
        label: "System Prompt (voice and style)",
        width: "w-full",
    },
};

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
                description: persona.description || "",
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

    const fields = {...PERSONA_FIELDS};

    return (
        <Modal title={isNew ? "New Persona" : "Edit Persona"} setShowModal={setModalState} isLoading={addLoading || updateLoading}>
            <div className="flex flex-wrap">
                {Object.entries(fields).map(([fieldName, fieldKwargs]) => (
                    <div key={fieldName} className={"px-4 " + (fieldKwargs.width || "w-full")}>
                        <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4">
                            {fieldKwargs.label}{fieldKwargs.required ? "*" : ""}
                            {fieldErrors[fieldName] && (
                                <span className="text-red-600 font-normal italic"> ({fieldErrors[fieldName]})</span>
                            )}
                        </label>
                        {fieldKwargs.type === "textarea" ? (
                            <textarea
                                rows={8}
                                className="w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-gray-900 dark:text-gray-400 leading-tight focus:outline-none focus:shadow-outline"
                                value={values[fieldName] || ""}
                                onChange={(e) => setValues({...values, [fieldName]: e.target.value})}
                            />
                        ) : (
                            <input
                                type={fieldKwargs.type}
                                className="w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-gray-900 dark:text-gray-400 leading-tight focus:outline-none focus:shadow-outline"
                                value={values[fieldName] || ""}
                                placeholder={fieldKwargs.placeholder || ""}
                                onChange={(e) => setValues({...values, [fieldName]: e.target.value})}
                                autoFocus={fieldKwargs.autoFocus && !window.matchMedia("(max-width: 640px)").matches}
                            />
                        )}
                    </div>
                ))}
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
            <table className="min-w-full my-2">
                <tbody>
                {(personas?.length ?? 0) === 0 ? (
                    <tr>
                        <td className="py-2 px-4 text-center text-gray-500">No personas yet - create the first one.</td>
                    </tr>
                ) : (
                    personas.map((persona) => (
                        <tr key={"persona" + persona.id} className="hover:bg-gray-100 dark:hover:bg-gray-900 border-b">
                            <td className="py-2 px-4">
                                <div className="font-semibold">{persona.name}{persona.is_builtin && (
                                    <span className="ml-2 text-xs text-gray-500 italic">(built-in)</span>
                                )}</div>
                                <div className="text-sm text-gray-500">{persona.description}</div>
                            </td>
                            <td className="py-2 px-2 whitespace-nowrap">
                                <EditButton additionalClasses="mx-1" onClick={() => setEditing(persona)} label={false} larger={true}/>
                                {!persona.is_builtin && (
                                    <DeleteButton additionalClasses="mx-1" onClick={() => handleDelete(persona)} label={false} larger={true}/>
                                )}
                            </td>
                        </tr>
                    ))
                )}
                </tbody>
            </table>
            <div className="relative flex justify-between items-center">
                <AddButton onClick={() => setEditing({})} label="New Persona" highlighted={true} larger={true}/>
                <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => refetch()}>Refresh</button>
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

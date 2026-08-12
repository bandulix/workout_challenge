import React, {useEffect, useState} from "react";
import {Camera, Send, X} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {useDispatch} from "react-redux";
import {drillInstructorApi, usePostDrillPhotoMutation} from "../utils/reducers/drillInstructorSlice";
import {compressImage} from "../utils/imageCompress";

// Photo sharing for the coach feed. The camera button is ALWAYS visible
// while the coach is on duty - when the server's AI model can't see
// pictures (vision probe failed), a click explains that instead of
// opening the picker (better discoverability than a hidden feature).
// The backend endpoint still refuses photo posts without vision - the
// gate there protects against LLM cost abuse via the API.
export default function PhotoPost({competitionId, visionCapable, parentId, onPosted}) {
    const [open, setOpen] = useState(false);
    const [hint, setHint] = useState(false);
    return (
        <>
            <button onClick={() => {
                        if (!visionCapable) {
                            setHint((v) => !v);
                            return;
                        }
                        setHint(false);
                        setOpen((v) => !v);
                    }}
                    title="Share a photo"
                    aria-label="Share a photo"
                    className="shrink-0 min-h-[36px] min-w-[36px] rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 transition shadow-glow-volt flex items-center justify-center">
                <Camera className="h-4 w-4"/>
            </button>
            {hint && (
                <div className="w-full px-1 pb-1 -mt-1">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Photo posts are unavailable right now - the AI model configured on this
                        server can't see pictures. (Organizer: pick a vision-capable model in
                        Site Settings → AI.)
                    </p>
                </div>
            )}
            {open && visionCapable && (
                <PhotoComposer competitionId={competitionId} parentId={parentId} onDone={() => setOpen(false)} onPosted={onPosted}/>
            )}
        </>
    );
}


// The composer itself: pick (or take, on mobile) a picture, it gets
// compressed before upload (see utils/imageCompress.js), then posted as
// a thread root - the coach reacts, participants reply through the
// regular thread UI.
function PhotoComposer({competitionId, parentId, onDone, onPosted}) {
    const fileInput = React.useRef(null);
    const [file, setFile] = useState(null);
    const [error, setError] = useState(null);
    const [posting, setPosting] = useState(false);
    const [postPhoto] = usePostDrillPhotoMutation();
    const dispatch = useDispatch();

    // Open the picker as soon as the composer mounts (the button already
    // said "I want to share a photo" - no second tap).
    useEffect(() => {
        fileInput.current?.click();
    }, []);

    // Local preview of the picked file (instant, no upload needed).
    const [preview, setPreview] = useState(null);
    useEffect(() => {
        if (!file) {
            setPreview(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    function reset() {
        setFile(null);
        setError(null);
        onDone?.();
    }

    async function handleSend() {
        if (!file || posting) return;
        setError(null);
        setPosting(true);
        try {
            const compressed = await compressImage(file);
            const posted = await postPhoto({competition: competitionId, parent: parentId, image: compressed}).unwrap();
            reset();
            // The coach's reaction is generated asynchronously (usually a
            // few seconds) - two delayed re-fetches pick it up quickly,
            // the regular 60s poll is the backstop.
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage'])), 8000);
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage'])), 20000);
            onPosted?.(posted);
        } catch (err) {
            const data = err?.data || {};
            setError(data.image || data.caption || data.competition || "Could not post your picture - please try again.");
        } finally {
            setPosting(false);
        }
    }

    return (
        <div className="w-full px-1 py-3 space-y-2">
            <input ref={fileInput} type="file" accept="image/*" className="hidden"
                   onChange={(e) => { setError(null); setFile(e.target.files?.[0] || null); e.target.value = ""; }}/>
            {file && (
                <div className="relative inline-block">
                    <img src={preview} alt="Upload preview"
                         className="max-h-48 rounded-xl border border-gray-200/70 dark:border-ink-700/60"/>
                    <button onClick={reset} aria-label="Discard photo"
                            className="absolute -top-2 -right-2 min-h-[28px] min-w-[28px] rounded-full bg-ink-900 text-white flex items-center justify-center hover:bg-ink-700 transition">
                        <X className="h-3.5 w-3.5"/>
                    </button>
                </div>
            )}
            <div className="flex items-center gap-2">
                {!file && (
                    <button onClick={() => fileInput.current?.click()}
                            className="text-xs font-bold uppercase tracking-wide text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 transition min-h-[44px]">
                        Choose a different picture
                    </button>
                )}
                <div className="flex-1"/>
                <button onClick={handleSend} disabled={posting || !file}
                        aria-label="Post photo"
                        className="shrink-0 min-h-[44px] min-w-[44px] rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none flex items-center justify-center">
                    {posting ? <BeatLoader size={5} color="#0a0d06"/> : <Send className="h-4 w-4"/>}
                </button>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}

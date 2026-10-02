import React, {useEffect, useRef, useState} from "react";
import {Camera, Image as ImageIcon, Send, X} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {useDispatch} from "react-redux";
import {drillInstructorApi, usePostDrillPhotoMutation} from "../utils/reducers/drillInstructorSlice";
import {compressImage} from "../utils/imageCompress";
import {decodePhoto} from "../utils/heicDecode";
import {errText} from "../utils/errors";
import {isAcceptablePhoto, isNativeCameraAvailable, isPhotoPickCancel, pickNativePhoto} from "../utils/nativeCamera";
import {OverlaySheet} from "../forms/basicComponents";

// Photo sharing for the coach feed. The camera is NOT always visible:
// the server decides whether this workout can plant/claim an Echo or
// satisfy today's photo order and hands the client a `purpose`; without
// one the button renders nothing (`if (!action) return null`). The photo
// window and ownership are resolved + enforced server-side - the client
// duplicates none of that eligibility logic. The picture hangs under
// the own activity it was started from (parentId).
const PILL =
    "inline-flex w-full items-center justify-center gap-2 btn-plate px-4 sm:px-5 py-2.5 text-sm font-bold transition min-h-[44px]";
const CHIP =
    "inline-flex items-center justify-center gap-1.5 btn-plate px-3.5 py-2 text-xs font-bold transition min-h-[36px]";
const GHOST =
    "inline-flex items-center gap-1.5 rounded-full btn-glass px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-ink-950 dark:hover:text-white transition min-h-[32px] shrink-0";
const ICON =
    "shrink-0 min-h-[44px] min-w-[44px] btn-plate transition flex items-center justify-center";

const PURPOSES = {
    echo: {
        label: "Capture Echo relic",
        explanation: "This photo makes the Echo a visible relic. Without it, the Echo stays off the board.",
    },
    photo_order: {
        label: "Complete today's photo order",
        explanation: "This photo completes today's order; it does not add flat points.",
    },
};

export default function PhotoPost({competitionId, visionCapable, parentId, onPosted, purpose, variant = "icon"}) {
    const [open, setOpen] = useState(false);
    const [ready, setReady] = useState(false);
    const [hint, setHint] = useState(null);
    const buttonClass = variant === "pill" ? PILL : variant === "chip" ? CHIP : variant === "ghost" ? GHOST : ICON;
    const action = PURPOSES[purpose];

    function close() {
        setOpen(false);
        setReady(false);
        setHint(null);
    }

    function continueToPicker() {
        if (!visionCapable) {
            setHint("vision");
            return;
        }
        if (!parentId) {
            setHint("workout");
            return;
        }
        setReady(true);
    }

    if (!action) return null;

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}
                    title={action.label} aria-label={action.label} className={buttonClass}>
                <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>
                {variant !== "icon" && <span>{action.label}</span>}
            </button>
            {open && (
                <OverlaySheet title={action.label} onClose={close}
                              labelledBy="photo-post-title" zClass="z-[80]">
                    {hint ? (
                        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            {hint === "workout"
                                ? "Photos attach to an eligible workout. Log one before posting a photo."
                                : "Photo posts are unavailable right now - the AI model configured on this server can't see pictures. (Organizer: pick a vision-capable model in Site Settings → AI.)"}
                        </p>
                    ) : ready ? (
                        <PhotoComposer competitionId={competitionId} parentId={parentId}
                                       onDone={close} onPosted={onPosted}/>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                                {action.explanation}
                            </p>
                            <button type="button" onClick={continueToPicker}
                                    className="w-full min-h-[44px] btn-plate px-4 py-2 text-sm font-bold">
                                Continue to camera or gallery
                            </button>
                        </div>
                    )}
                </OverlaySheet>
            )}
        </>
    );
}


// The composer itself: take a picture or pick one from the gallery,
// compress it (see utils/imageCompress.js), then attach it to the
// caller's latest own workout thread (parentId).
function PhotoComposer({competitionId, parentId, onDone, onPosted}) {
    const cameraId = React.useId();
    const galleryId = React.useId();
    const native = isNativeCameraAvailable();
    const [file, setFile] = useState(null);
    const [error, setError] = useState(null);
    const [posting, setPosting] = useState(false);
    const [postPhoto] = usePostDrillPhotoMutation();
    const dispatch = useDispatch();
    // Delayed re-fetch timers: cleared on unmount so a composer closed
    // right after posting doesn't dispatch into a gone component tree.
    const refetchTimers = useRef([]);
    useEffect(() => () => {
        refetchTimers.current.forEach(clearTimeout);
        refetchTimers.current = [];
    }, []);

    function applyPicked(picked) {
        setError(null);
        if (!picked) return;
        // Reject SVG/HTML; allow empty type / HEIC / image/jpg (Android).
        // Pixels are checked by the preview decode + server re-encode.
        if (!isAcceptablePhoto(picked)) {
            setFile(null);
            setError("Please pick a photo (JPEG, PNG, WebP, GIF or HEIC).");
            return;
        }
        setFile(picked);
    }

    function onPicked(e) {
        const picked = e.target.files?.[0] || null;
        e.target.value = "";
        applyPicked(picked);
    }

    async function pick(kind) {
        setError(null);
        try {
            const picked = await pickNativePhoto(kind);
            if (picked) applyPicked(picked);
        } catch (err) {
            if (isPhotoPickCancel(err)) return;
            setError(kind === "camera"
                ? "Could not open the camera. Check camera permission in system settings."
                : "Could not open the gallery.");
        }
    }

    // Decode to a canvas JPEG so the <img> src is pixels, not a blob: of
    // the raw pick (CodeQL js/xss-through-dom; also defangs SVG). HEIC
    // picks (Samsung gallery) are converted first - see utils/heicDecode.
    const [preview, setPreview] = useState(null);
    useEffect(() => {
        if (!file) {
            setPreview(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const bitmap = await decodePhoto(file);
                if (cancelled) { bitmap.close?.(); return; }
                const max = 800;
                const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                bitmap.close();
                const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
                if (!cancelled) setPreview(dataUrl);
            } catch {
                if (!cancelled) {
                    setPreview(null);
                    setError("Could not preview that file.");
                }
            }
        })();
        return () => { cancelled = true; };
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
            const refetch = () => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage', 'DrillRoast']));
            refetchTimers.current.push(setTimeout(refetch, 8000), setTimeout(refetch, 20000));
            onPosted?.(posted);
        } catch (err) {
            setError(errText(err, "Could not post your picture - please try again."));
        } finally {
            setPosting(false);
        }
    }

    const pickClass =
        "flex flex-col items-center justify-center gap-2 rounded-2xl btn-glass min-h-[7.5rem] px-4 py-5 text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 hover:text-ink-950 dark:hover:text-white transition cursor-pointer";

    return (
        <div className="w-full min-w-0 space-y-4">
            {/* Web: a <label> click is a real user gesture, so Chrome
                honours `capture` and opens the camera. Hidden+JS .click()
                does not. Native uses Capacitor takePhoto instead. */}
            {!native && (
                <>
                    <input id={cameraId} type="file" accept="image/*" capture="environment"
                           className="sr-only" onChange={onPicked}/>
                    <input id={galleryId} type="file" accept="image/*"
                           className="sr-only" onChange={onPicked}/>
                </>
            )}
            {file ? (
                <div className="relative">
                    {/* HEIC conversion takes a moment - show a placeholder
                        instead of an <img> with no (valid) src. */}
                    {preview ? (
                        <img src={preview} alt="Upload preview"
                             className="mx-auto max-h-[50vh] w-auto max-w-full rounded-2xl"/>
                    ) : !error ? (
                        <div className="mx-auto flex h-48 w-full max-w-sm items-center justify-center rounded-2xl bg-ink-950/5 dark:bg-white/5">
                            <BeatLoader size={8} color="#d7ff3e"/>
                        </div>
                    ) : null}
                    <button type="button" onClick={() => { setFile(null); setError(null); }}
                            aria-label="Discard photo"
                            className="absolute top-2 right-2 min-h-[36px] min-w-[36px] rounded-full bg-ink-950/80 text-white flex items-center justify-center hover:bg-ink-800 transition">
                        <X className="h-4 w-4"/>
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {native ? (
                        <button type="button" onClick={() => pick("camera")} className={pickClass}>
                            <Camera className="h-6 w-6"/>
                            Camera
                        </button>
                    ) : (
                        <label htmlFor={cameraId} className={pickClass}>
                            <Camera className="h-6 w-6"/>
                            Camera
                        </label>
                    )}
                    {native ? (
                        <button type="button" onClick={() => pick("gallery")} className={pickClass}>
                            <ImageIcon className="h-6 w-6"/>
                            Gallery
                        </button>
                    ) : (
                        <label htmlFor={galleryId} className={pickClass}>
                            <ImageIcon className="h-6 w-6"/>
                            Gallery
                        </label>
                    )}
                </div>
            )}
            <button type="button" onClick={handleSend} disabled={posting || !file}
                    className="w-full inline-flex items-center justify-center gap-2 btn-plate px-5 py-3 text-sm font-bold transition disabled:opacity-50 disabled:shadow-none min-h-[48px]">
                {posting ? <BeatLoader size={6} color="#0b0b0c"/> : <><Send className="h-4 w-4"/> Post photo</>}
            </button>
            {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
    );
}

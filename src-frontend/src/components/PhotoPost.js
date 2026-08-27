import React, {useEffect, useState} from "react";
import {Camera, Image as ImageIcon, Send, X} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {useDispatch} from "react-redux";
import {drillInstructorApi, usePostDrillPhotoMutation} from "../utils/reducers/drillInstructorSlice";
import {compressImage} from "../utils/imageCompress";
import {isAcceptablePhoto, isNativeCameraAvailable, isPhotoPickCancel, pickNativePhoto} from "../utils/nativeCamera";
import {OverlaySheet} from "../forms/basicComponents";

// Photo sharing for the coach feed. The camera button is ALWAYS visible
// while the coach is on duty - a click without a latest-own-workout
// parent, or when the server's AI model can't see pictures, explains
// that instead of opening the picker. The picture always hangs under
// the caller's latest activity comment (resolved server-side).
const PILL =
    "inline-flex w-full items-center justify-center gap-2 rounded-full bg-volt-400 text-ink-950 px-4 sm:px-5 py-2.5 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt min-h-[44px]";
const CHIP =
    "inline-flex items-center justify-center gap-1.5 rounded-full bg-volt-400 text-ink-950 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt min-h-[36px]";
const GHOST =
    "inline-flex items-center gap-1.5 rounded-full btn-glass px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-volt-700 dark:hover:text-volt-300 transition min-h-[32px] shrink-0";
const ICON =
    "shrink-0 min-h-[44px] min-w-[44px] rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 transition shadow-glow-volt flex items-center justify-center";

export function PhotoCamBonus({large = false, neon = true, plus = false}) {
    return (
        <span className={"inline-flex items-center gap-[3px] font-extrabold tabular-nums leading-none " +
            (large ? "text-[11px]" : "text-[9px]") + " " +
            (neon ? "points-cam" : "")}>
            <Camera className={(large ? "h-3.5 w-3.5" : "h-3 w-3") + " block shrink-0"}
                    aria-hidden="true" strokeWidth={2.4}/>
            <span className="leading-none">{plus ? "+10P" : "10P"}</span>
        </span>
    );
}

export default function PhotoPost({competitionId, visionCapable, parentId, onPosted, variant = "icon", label = "Photo"}) {
    const [open, setOpen] = useState(false);
    const [hint, setHint] = useState(null);
    const buttonClass = variant === "pill" ? PILL : variant === "chip" ? CHIP : variant === "ghost" ? GHOST : ICON;

    function close() {
        setOpen(false);
        setHint(null);
    }

    return (
        <>
            <button type="button"
                    onClick={() => {
                        if (!visionCapable) {
                            setHint("vision");
                            setOpen(true);
                            return;
                        }
                        if (!parentId) {
                            setHint("workout");
                            setOpen(true);
                            return;
                        }
                        setHint(null);
                        setOpen(true);
                    }}
                    title={`${label} · 10P`}
                    aria-label={`${label}, 10 points`}
                    className={buttonClass}>
                {variant === "ghost" ? (
                    <>
                        <Camera className="h-3.5 w-3.5 shrink-0"/>
                        +10P
                    </>
                ) : (
                    <>
                        <PhotoCamBonus large neon={false} plus/>
                        {variant === "pill" && <span>{label}</span>}
                    </>
                )}
            </button>
            {open && (
                <OverlaySheet title={label || "Add a photo"} onClose={close}
                              labelledBy="photo-post-title" zClass="z-[80]">
                    {hint ? (
                        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            {hint === "workout"
                                ? "Photos hang under your latest workout. Log one and wait for the coach to comment first."
                                : "Photo posts are unavailable right now - the AI model configured on this server can't see pictures. (Organizer: pick a vision-capable model in Site Settings → AI.)"}
                        </p>
                    ) : (
                        <PhotoComposer competitionId={competitionId} parentId={parentId}
                                       onDone={close} onPosted={onPosted}/>
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
    // the raw pick (CodeQL js/xss-through-dom; also defangs SVG).
    const [preview, setPreview] = useState(null);
    useEffect(() => {
        if (!file) {
            setPreview(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const bitmap = await createImageBitmap(file);
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
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage', 'DrillRoast'])), 8000);
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage', 'DrillRoast'])), 20000);
            onPosted?.(posted);
        } catch (err) {
            const data = err?.data || {};
            setError(data.image || data.caption || data.competition || "Could not post your picture - please try again.");
        } finally {
            setPosting(false);
        }
    }

    const pickClass =
        "flex flex-col items-center justify-center gap-2 rounded-2xl btn-glass min-h-[7.5rem] px-4 py-5 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 hover:text-volt-700 dark:hover:text-volt-300 transition cursor-pointer";

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
                    <img src={preview} alt="Upload preview"
                         className="mx-auto max-h-[50vh] w-auto max-w-full rounded-2xl"/>
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
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-volt-400 text-ink-950 px-5 py-3 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none min-h-[48px]">
                {posting ? <BeatLoader size={6} color="#0b0b0c"/> : <><Send className="h-4 w-4"/> Post photo</>}
            </button>
            {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
    );
}

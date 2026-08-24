import React, {useEffect, useRef, useState} from "react";
import {useLocation} from "react-router-dom";
import {Camera, Crown, Image as ImageIcon} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {useDispatch} from "react-redux";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";
import {drillInstructorApi, useGetEchoesQuery, useUploadEchoArtMutation} from "../utils/reducers/drillInstructorSlice";
import {compressImage} from "../utils/imageCompress";
import {isAcceptablePhoto, isPhotoPickCancel, pickNativePhoto} from "../utils/nativeCamera";
import {notice} from "../utils/dialogs";

const DISMISS_KEY = "wc-echo-art-nudge";
const PUBLIC_PATHS = ["/", "/login", "/signup", "/logout", "/password"];

function readDismissed() {
    try {
        const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
        if (!Array.isArray(raw)) return new Set();
        return new Set(raw.slice(0, 200).map(String));
    } catch {
        return new Set();
    }
}

function rememberDismissed(id) {
    const next = readDismissed();
    next.add(String(id));
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
}

export default function EchoArtNudge() {
    const location = useLocation();
    const onPublic = PUBLIC_PATHS.some((p) => location.pathname === p || location.pathname.startsWith("/password"));
    const {data: user} = useGetUserByIdQuery("me", {skip: onPublic});
    const {data: echoes} = useGetEchoesQuery(undefined, {skip: onPublic || !user});
    const [uploadArt] = useUploadEchoArtMutation();
    const dispatch = useDispatch();

    const [nudge, setNudge] = useState(null);
    const [snoozed, setSnoozed] = useState(false);
    const [busy, setBusy] = useState(false);
    const cameraInput = useRef(null);
    const galleryInput = useRef(null);

    useEffect(() => {
        if (snoozed || busy || !echoes) return undefined;
        const dismissed = readDismissed();
        const missing = echoes.filter((e) => e.can_upload_art && !e.image && !dismissed.has(String(e.id)));
        const id = setTimeout(() => setNudge(missing[0] || null), 800);
        return () => clearTimeout(id);
    }, [echoes, snoozed, busy]);

    function close() {
        if (nudge) rememberDismissed(nudge.id);
        setSnoozed(true);
        setNudge(null);
    }

    async function send(file) {
        if (!file || !nudge) return;
        if (!isAcceptablePhoto(file)) {
            notice("Please pick a photo (JPEG, PNG, WebP, GIF or HEIC).");
            return;
        }
        setBusy(true);
        try {
            const compressed = await compressImage(file);
            await uploadArt({id: nudge.id, image: compressed}).unwrap();
            rememberDismissed(nudge.id);
            setSnoozed(true);
            setNudge(null);
            notice("The coach is painting this into Echo art — give it a few seconds.");
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(["DrillEcho"])), 8000);
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(["DrillEcho"])), 20000);
        } catch (err) {
            notice(err?.data?.image || err?.data?.detail || "Could not upload that picture.");
        } finally {
            setBusy(false);
        }
    }

    async function pick(kind) {
        try {
            const native = await pickNativePhoto(kind);
            if (native) {
                await send(native);
                return;
            }
        } catch (err) {
            if (isPhotoPickCancel(err)) return;
        }
        if (kind === "camera") cameraInput.current?.click();
        else galleryInput.current?.click();
    }

    if (!nudge) return null;

    const others = Math.max(0, (echoes || []).filter((e) => e.can_upload_art && !e.image && e.id !== nudge.id).length);

    return (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={() => { if (!busy) close(); }}>
            <div className="w-full max-w-md rounded-3xl glass-card p-6 animate-pop-in"
                 onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3">
                    <span className="h-11 w-11 rounded-2xl bg-volt-400/20 flex items-center justify-center shrink-0">
                        <Crown className="h-5 w-5 text-volt-600 dark:text-volt-400"/>
                    </span>
                    <div className="min-w-0">
                        <p className="font-display text-sm uppercase tracking-wide">Give your Echo a face</p>
                        <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            You’re holding <span className="font-semibold">{nudge.title}</span>
                            {others > 0 ? ` (and ${others} more)` : ""}. It still has the crown placeholder.
                            Add a photo and the coach will paint it into trophy art.
                        </p>
                    </div>
                </div>

                <input ref={cameraInput} type="file" accept="image/*,image/heic,image/heif" capture="user" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; send(f); }}/>
                <input ref={galleryInput} type="file" accept="image/*,image/heic,image/heif" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; send(f); }}/>

                <div className="mt-6 flex flex-wrap justify-end gap-2">
                    <button type="button" disabled={busy} onClick={close}
                            className="min-h-[44px] px-4 rounded-full text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50">
                        Later
                    </button>
                    <button type="button" disabled={busy} onClick={() => pick("camera")}
                            className="min-h-[44px] px-4 rounded-full btn-glass text-sm font-bold uppercase tracking-wide inline-flex items-center gap-1.5 disabled:opacity-50">
                        <Camera className="h-3.5 w-3.5"/> Camera
                    </button>
                    <button type="button" disabled={busy} onClick={() => pick("gallery")}
                            className="min-h-[44px] px-4 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide inline-flex items-center gap-1.5 disabled:opacity-50">
                        {busy ? <BeatLoader size={6} color="#0b0b0c"/> : <ImageIcon className="h-3.5 w-3.5"/>}
                        Gallery
                    </button>
                </div>
            </div>
        </div>
    );
}

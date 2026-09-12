import React, {useRef, useState} from "react";
import {Camera, Crown, Share2, Trash2} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {useDispatch} from "react-redux";
import {FullImageSheet, PaneHead} from "./uiBits";
import {useProtectedImage} from "../utils/protectedMedia";
import {compressImage} from "../utils/imageCompress";
import {isAcceptablePhoto, isPhotoPickCancel, pickNativePhoto} from "../utils/nativeCamera";
import {
    drillInstructorApi,
    useDeleteEchoMutation,
    useGetEchoesQuery,
    useUploadEchoArtMutation,
} from "../utils/reducers/drillInstructorSlice";
import usePollingInterval from "../utils/usePollingInterval";
import {confirmAction, notice} from "../utils/dialogs";
import {sharePostCard} from "../utils/shareCard";
import {echoSfxItems, useSfxObserver} from "../utils/sfx";

const LIVE = 3;

function EchoArt({url, title, canUpload, echoId}) {
    const {src} = useProtectedImage(url, "card");
    const [uploadArt] = useUploadEchoArtMutation();
    const dispatch = useDispatch();
    const fileInput = useRef(null);
    const [busy, setBusy] = useState(false);
    const [lightbox, setLightbox] = useState(false);

    async function send(file) {
        if (!file) return;
        if (!isAcceptablePhoto(file)) {
            notice("Please pick a photo (JPEG, PNG, WebP, GIF or HEIC).");
            return;
        }
        setBusy(true);
        try {
            const compressed = await compressImage(file);
            await uploadArt({id: echoId, image: compressed}).unwrap();
            notice("The coach is painting this into Echo art — give it a few seconds.");
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(["DrillEcho"])), 8000);
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(["DrillEcho"])), 20000);
        } catch (err) {
            notice(err?.data?.image || err?.data?.detail || "Could not upload that picture.");
        } finally {
            setBusy(false);
        }
    }

    async function openPicker() {
        try {
            const native = await pickNativePhoto();
            if (native) {
                await send(native);
                return;
            }
        } catch (err) {
            if (!isPhotoPickCancel(err)) notice("Could not open the camera.");
            return;
        }
        fileInput.current?.click();
    }

    return (
        <>
            <div className="relative overflow-hidden rounded-t-3xl">
                {src ? (
                    <button type="button" onClick={() => setLightbox(true)} className="block w-full">
                        <img src={src} alt="" className="h-28 w-full object-cover"/>
                    </button>
                ) : canUpload ? (
                    <button type="button" onClick={openPicker} disabled={busy}
                            className="h-28 w-full bg-gradient-to-br from-ink-800 via-ink-900 to-black flex flex-col items-center justify-center gap-1">
                        {busy ? <BeatLoader size={6} color="#d7ff3e"/> : (
                            <>
                                <Camera className="h-6 w-6 text-volt-400"/>
                                <span className="text-[10px] font-extrabold uppercase tracking-wide text-volt-400">Add art</span>
                            </>
                        )}
                    </button>
                ) : (
                    <div className="h-28 w-full bg-gradient-to-br from-ink-800 via-ink-900 to-black flex items-center justify-center">
                        <Crown className="h-7 w-7 text-volt-400/70"/>
                    </div>
                )}
                {canUpload && src && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); openPicker(); }}
                            disabled={busy}
                            aria-label="Change Echo art"
                            className="absolute bottom-2 right-2 z-10 inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full bg-ink-950/70 text-volt-400">
                        {busy ? <BeatLoader size={4} color="#d7ff3e"/> : <Camera className="h-4 w-4"/>}
                    </button>
                )}
                <input ref={fileInput} type="file" accept="image/*,image/heic,image/heif" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; send(f); }}/>
            </div>
            {lightbox && (
                <FullImageSheet url={url} title={title || "Echo"} fallback={src}
                                onClose={() => setLightbox(false)} zClass="z-[70]"/>
            )}
        </>
    );
}

function EchoTile({echo, onDelete, busy}) {
    return (
        <article className="min-w-0 rounded-3xl glass-card overflow-hidden text-ink-950 dark:text-white">
            <EchoArt url={echo.image} title={echo.title}
                     canUpload={Boolean(echo.can_upload_art)} echoId={echo.id}/>
            <div className="px-2.5 py-2">
                <p className="text-[12px] font-bold leading-tight truncate">{echo.title}</p>
                <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400 truncate">
                    {echo.holder_name || "Held"} · {echo.metric_label}
                </p>
                <div className="mt-1.5 flex items-center gap-1">
                    <button type="button"
                            onClick={() => sharePostCard({
                                title: `${echo.title} · Power ${echo.power}`,
                                text: echo.narrative,
                                imageUrl: echo.image,
                            })}
                            className="inline-flex items-center gap-1 rounded-full btn-glass px-2 py-1 text-[10px] font-bold uppercase tracking-wide">
                        <Share2 className="h-3 w-3"/> Share
                    </button>
                    {echo.can_delete && (
                        <button type="button" onClick={() => onDelete(echo)} disabled={busy}
                                aria-label={`Delete ${echo.title}`}
                                className="ml-auto inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full text-gray-400 hover:text-red-500">
                            <Trash2 className="h-3.5 w-3.5"/>
                        </button>
                    )}
                </div>
            </div>
        </article>
    );
}

export default function EchoLiveStrip({competitionId, userId}) {
    const poll = usePollingInterval(90000);
    const {data: echoes} = useGetEchoesQuery(
        {competition: competitionId},
        {pollingInterval: poll, skip: !competitionId},
    );
    const [removeEcho, {isLoading: busy}] = useDeleteEchoMutation();
    const live = (echoes || [])
        .filter((e) => e.status === "undefeated" || e.status === "contested")
        .slice(0, LIVE);
    useSfxObserver(`echoes:${competitionId}`, echoSfxItems(echoes, userId), echoes !== undefined);

    if (live.length === 0) return null;

    async function onDelete(echo) {
        const ok = await confirmAction(`Delete ${echo.title}? The trophy and its art are gone.`);
        if (!ok) return;
        try {
            await removeEcho(echo.id).unwrap();
        } catch (err) {
            notice(err?.data?.detail || "Could not delete that Echo.");
        }
    }

    return (
        <div className="mb-4">
            <PaneHead title="Live Echoes" hint="Beat the mark, take the relic"/>
            <div className="grid grid-cols-3 gap-3">
                {live.map((echo) => (
                    <EchoTile key={echo.id} echo={echo} onDelete={onDelete} busy={busy}/>
                ))}
            </div>
        </div>
    );
}

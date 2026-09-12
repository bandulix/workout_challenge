import React, {useState} from "react";
import {Crown, Share2, Trash2} from "lucide-react";
import {useDispatch} from "react-redux";
import {FullImageSheet, PaneHead} from "./uiBits";
import {useProtectedImage} from "../utils/protectedMedia";
import {
    useDeleteEchoMutation,
    useGetEchoesQuery,
} from "../utils/reducers/drillInstructorSlice";
import {usersApi} from "../utils/reducers/usersSlice";
import {statsApi} from "../utils/reducers/statsSlice";
import usePollingInterval from "../utils/usePollingInterval";
import {confirmAction, notice} from "../utils/dialogs";
import {sharePostCard} from "../utils/shareCard";
import {echoSfxItems, useSfxObserver} from "../utils/sfx";

const LIVE = 3;

function EchoArt({url, title}) {
    const {src} = useProtectedImage(url, "card");
    const [lightbox, setLightbox] = useState(false);
    return (
        <>
            <div className="relative overflow-hidden rounded-t-3xl">
                {src ? (
                    <button type="button" onClick={() => setLightbox(true)} className="block w-full">
                        <img src={src} alt="" className="h-28 w-full object-cover"/>
                    </button>
                ) : (
                    <div className="h-28 w-full bg-gradient-to-br from-ink-800 via-ink-900 to-black flex items-center justify-center">
                        <Crown className="h-7 w-7 text-volt-400/70"/>
                    </div>
                )}
            </div>
            {lightbox && url && (
                <FullImageSheet url={url} title={title || "Echo"} fallback={src}
                                onClose={() => setLightbox(false)} zClass="z-[70]"/>
            )}
        </>
    );
}

function EchoTile({echo, onDelete, busy}) {
    return (
        <article className="min-w-0 rounded-3xl glass-card overflow-hidden text-ink-950 dark:text-white">
            <EchoArt url={echo.image} title={echo.title}/>
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
    const dispatch = useDispatch();
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
            dispatch(usersApi.util.invalidateTags(["User"]));
            dispatch(statsApi.util.invalidateTags(["Stats"]));
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

import React, {useState} from "react";
import {Crown, Info, Share2, Trash2} from "lucide-react";
import {useDispatch} from "react-redux";
import {PaneHead} from "./uiBits";
import {RoastGallery} from "./gameBits";
import {Modal} from "../forms/basicComponents";
import {useProtectedImage} from "../utils/protectedMedia";
import {
    useDeleteEchoMutation,
    useGetEchoesQuery,
} from "../utils/reducers/drillInstructorSlice";
import {usersApi} from "../utils/reducers/usersSlice";
import {statsApi} from "../utils/reducers/statsSlice";
import usePollingInterval from "../utils/usePollingInterval";
import {confirmAction} from "../utils/dialogs";
import {toast} from "../utils/toasts";
import {sharePostCard} from "../utils/shareCard";
import {echoSfxItems, useSfxObserver} from "../utils/sfx";

const LIVE = 3;

const STATUS_LABEL = {
    undefeated: "Live",
    contested: "Contested",
    immortal: "Immortal",
    retired: "Retired",
};

function EchoExplainer() {
    return (
        <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 space-y-3 px-1">
            <p>
                <b>Echoes are relics for legendary sessions.</b> Log a standout mark -
                the longest ride, the hardest climb, the biggest day - and the coach
                casts it into a relic with its own artwork.
            </p>
            <p>
                <b>Beat the mark, take the relic.</b> Anyone who tops it in the same
                sport claims the Echo from its holder - the feed calls it out and
                both get a push. Holders wear the crown on their avatar.
            </p>
            <p>
                <b>Immortal.</b> A relic that survives <b>3 takeovers</b> turns
                immortal on the spot; everything still alive at the final whistle
                is immortalized too. The planter collects the Echo Immortal tag.
            </p>
        </div>
    );
}

function EchoArt({url, title, onOpen}) {
    const {src} = useProtectedImage(url, "card");
    return (
        <div className="relative overflow-hidden rounded-t-3xl">
            {src ? (
                <button type="button" onClick={onOpen} className="block w-full"
                        aria-label={`View artwork of ${title || "the echo"}`}>
                    <img src={src} alt="" className="h-28 w-full object-cover"/>
                </button>
            ) : (
                <div className="h-28 w-full bg-gradient-to-br from-ink-800 via-ink-900 to-black flex items-center justify-center">
                    <Crown className="h-7 w-7 text-volt-400/70"/>
                </div>
            )}
        </div>
    );
}

function EchoTile({echo, onDelete, busy, onOpenArt, showStatus = false}) {
    return (
        <article className="min-w-0 rounded-3xl glass-card overflow-hidden text-ink-950 dark:text-white">
            <EchoArt url={echo.image} title={echo.title} onOpen={() => onOpenArt?.(echo)}/>
            <div className="px-2.5 py-2">
                <p className="text-[12px] font-bold leading-tight truncate">{echo.title}</p>
                <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400 truncate">
                    {echo.holder_name || "Held"} · {echo.metric_label}
                </p>
                {echo.status !== "immortal" && (echo.defenses || 0) > 0 && (
                    <p className="mt-0.5 text-[10px] font-bold text-volt-600 dark:text-volt-400">
                        Survived {echo.defenses}/3 takeovers
                    </p>
                )}
                <div className="mt-1.5 flex items-center gap-1">
                    <button type="button"
                            onClick={() => sharePostCard({
                                title: `${echo.title} · Power ${echo.power}`,
                                text: echo.narrative,
                                imageUrl: echo.image,
                            })}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full btn-glass px-3 py-1 text-[10px] font-bold uppercase tracking-wide">
                        <Share2 className="h-3.5 w-3.5"/> Share
                    </button>
                    {showStatus && (
                        <span className="shrink-0 rounded-full bg-volt-400/20 text-volt-700 dark:text-volt-300 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
                            {STATUS_LABEL[echo.status] || echo.status}
                        </span>
                    )}
                    {echo.can_delete && (
                        <button type="button" onClick={() => onDelete(echo)} disabled={busy}
                                aria-label={`Delete ${echo.title}`}
                                className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-400 hover:text-red-500">
                            <Trash2 className="h-4 w-4"/>
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
    const [showExplainer, setShowExplainer] = useState(false);
    const [showAll, setShowAll] = useState(false);
    // Index into galleryCards (echoes that actually have artwork).
    const [galleryIndex, setGalleryIndex] = useState(null);
    const live = (echoes || [])
        .filter((e) => e.status === "undefeated" || e.status === "contested")
        .slice(0, LIVE);
    useSfxObserver(`echoes:${competitionId}`, echoSfxItems(echoes, userId), echoes !== undefined);

    // Gallery cards for the fullscreen viewer: one per echo with art, in
    // strip order. Tapping a tile opens the viewer at that echo.
    const galleryEchoes = (echoes || []).filter((e) => e.image);
    const galleryCards = galleryEchoes.map((e) => ({
        image: e.image,
        title: e.title,
        body: e.narrative || "",
        subline: [e.holder_name || "Held", e.metric_label, STATUS_LABEL[e.status] || e.status]
            .filter(Boolean).join(" · "),
    }));

    function openGallery(echo) {
        const idx = galleryEchoes.findIndex((e) => e.id === echo.id);
        if (idx >= 0) setGalleryIndex(idx);
    }

    async function onDelete(echo) {
        const ok = await confirmAction(`Delete ${echo.title}? The relic and its art are gone.`);
        if (!ok) return;
        try {
            await removeEcho(echo.id).unwrap();
            dispatch(usersApi.util.invalidateTags(["User"]));
            dispatch(statsApi.util.invalidateTags(["Stats"]));
        } catch (err) {
            toast.error(err?.data?.detail || "Could not delete that Echo.");
        }
    }

    const head = (
        <PaneHead title="Live Echoes" hint="Beat the mark, take the relic">
            <button type="button" onClick={() => setShowExplainer(true)}
                    aria-label="How echoes work"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 transition">
                <Info className="h-4 w-4"/>
            </button>
            {(echoes || []).length > live.length && (
                <button type="button" onClick={() => setShowAll(true)}
                        className="inline-flex min-h-[44px] items-center rounded-full btn-glass px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide transition">
                    All {(echoes || []).length}
                </button>
            )}
        </PaneHead>
    );

    return (
        <div className="mb-4">
            {head}
            {live.length === 0 ? (
                /* Empty state doubles as the explainer - otherwise the
                   mechanic is invisible until the first relic exists. */
                <div className="rounded-3xl glass-card p-4 flex items-center gap-3 text-ink-950 dark:text-white">
                    <div className="h-11 w-11 shrink-0 rounded-2xl bg-volt-400/15 flex items-center justify-center">
                        <Crown className="h-5 w-5 text-volt-600 dark:text-volt-400"/>
                    </div>
                    <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                        No relics yet. Log a standout session and the coach casts it into
                        an <b>Echo</b> - beat someone's mark in the same sport and the
                        relic is yours. Holders wear the crown.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-3">
                    {live.map((echo) => (
                        <EchoTile key={echo.id} echo={echo} onDelete={onDelete} busy={busy}
                                  onOpenArt={openGallery}/>
                    ))}
                </div>
            )}

            {showExplainer && (
                <Modal title="How Echoes work" setShowModal={setShowExplainer}>
                    <EchoExplainer/>
                </Modal>
            )}
            {showAll && (
                <Modal title="All Echoes" setShowModal={setShowAll}>
                    <div className="grid grid-cols-2 gap-3 px-1 pb-1">
                        {(echoes || []).map((echo) => (
                            <EchoTile key={echo.id} echo={echo} onDelete={onDelete} busy={busy}
                                      onOpenArt={openGallery} showStatus/>
                        ))}
                    </div>
                </Modal>
            )}
            {galleryIndex != null && galleryCards[galleryIndex] && (
                <RoastGallery cards={galleryCards} index={galleryIndex} onIndex={setGalleryIndex}
                              onClose={() => setGalleryIndex(null)}/>
            )}
        </div>
    );
}

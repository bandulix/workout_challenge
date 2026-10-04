import React, {useState} from "react";
import {createPortal} from "react-dom";
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
import {noteworthyEchoes} from "../utils/echoVisibility";

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
                    <Crown className="h-7 w-7 text-white/30"/>
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
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">
                    {echo.holder_name || "Held"} · {echo.metric_label}
                </p>
                {echo.status !== "immortal" && (echo.defenses || 0) > 0 && (
                    <p className="mt-0.5 text-xs font-bold text-gray-500 dark:text-white/55">
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
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full btn-glass px-3 py-1 text-xs font-bold uppercase tracking-wide">
                        <Share2 className="h-3.5 w-3.5"/> Share
                    </button>
                    {showStatus && (
                        <span className="shrink-0 rounded-full bg-ink-950/5 text-gray-700 dark:bg-white/10 dark:text-white/80 text-xs font-bold uppercase tracking-wide px-2 py-0.5">
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

export default function EchoLiveStrip({competitionId, userId, archiveHost = null, placeArchiveInHeader = false}) {
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
    const allEchoes = echoes || [];
    const updates = noteworthyEchoes(allEchoes);
    useSfxObserver(`echoes:${competitionId}`, echoSfxItems(echoes, userId), echoes !== undefined);

    // Gallery cards for the fullscreen viewer: one per echo with art, in
    // archive order. Tapping a tile opens the viewer at that echo.
    const galleryEchoes = allEchoes.filter((e) => e.image);
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

    if (!allEchoes.length) return null;

    const archiveButton = (
        <button type="button" onClick={() => setShowAll(true)}
                className="inline-flex min-h-[44px] items-center rounded-full btn-glass px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition">
            Echo archive · {allEchoes.length}
        </button>
    );
    const explainerButton = (
        <button type="button" onClick={() => setShowExplainer(true)}
                aria-label="How Echoes work"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-400 hover:text-ink-950 dark:hover:text-white transition">
            <Info className="h-4 w-4"/>
        </button>
    );
    const head = (
        <PaneHead title="Echo updates" hint="New, threatened, or recently taken">
            {explainerButton}
            {!(archiveHost || placeArchiveInHeader) && archiveButton}
        </PaneHead>
    );
    const overlays = (
        <>
            {showExplainer && (
                <Modal title="How Echoes work" setShowModal={setShowExplainer}>
                    <EchoExplainer/>
                </Modal>
            )}
            {showAll && (
                <Modal title="All Echoes" setShowModal={setShowAll}>
                    <div className="grid grid-cols-2 gap-3 px-1 pb-1">
                        {allEchoes.map((echo) => (
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
        </>
    );
    // Quiet relics have no updates pane. Park the archive pill in the
    // season header beside Goals so it does not float over the feed.
    // While the header slot is still mounting, render nothing rather
    // than flashing the pill back into the feed column.
    const archiveInHeader = archiveHost ? createPortal(archiveButton, archiveHost) : null;
    const archiveInHeaderSlot = Boolean(archiveHost || placeArchiveInHeader);

    if (updates.length === 0 && archiveInHeaderSlot) {
        return (
            <>
                {archiveInHeader}
                {overlays}
            </>
        );
    }

    return (
        <>
            {archiveInHeader}
            <div className="mb-4">
                {updates.length > 0 ? (
                    <>
                        {head}
                        <div className="grid grid-cols-3 gap-3">
                            {updates.slice(0, LIVE).map((echo) => (
                                <EchoTile key={echo.id} echo={echo} onDelete={onDelete} busy={busy}
                                          onOpenArt={openGallery}/>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="flex justify-end">{archiveButton}</div>
                )}
                {overlays}
            </div>
        </>
    );
}

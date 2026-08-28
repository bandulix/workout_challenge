import React, {useEffect, useRef, useState} from "react";
import {Camera, Crown, ScrollText, Share2, Swords, Trash2} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {useDispatch} from "react-redux";
import {FullImageSheet, PaneHead, paneCardClass} from "./uiBits";
import {useProtectedImage} from "../utils/protectedMedia";
import {compressImage} from "../utils/imageCompress";
import {isAcceptablePhoto, isPhotoPickCancel, pickNativePhoto} from "../utils/nativeCamera";
import {
    drillInstructorApi,
    useChallengeEchoMutation,
    useDeleteEchoMutation,
    useGetEchoBookQuery,
    useGetEchoesQuery,
    useUploadEchoArtMutation,
} from "../utils/reducers/drillInstructorSlice";
import usePollingInterval from "../utils/usePollingInterval";
import {confirmAction, notice} from "../utils/dialogs";

function formatCountdown(iso, now) {
    if (!iso) return "";
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return "any moment";
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function useNowTick(active) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!active) return undefined;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [active]);
    return now;
}

const STATUS_TONE = {
    undefeated: "bg-volt-400 text-ink-950",
    contested: "bg-amber-400 text-ink-950",
    immortal: "bg-yellow-500 text-ink-950",
    retired: "bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-gray-300",
};

function EchoArt({url, title, canUpload, echoId}) {
    const {src} = useProtectedImage(url, "card");
    const [uploadArt] = useUploadEchoArtMutation();
    const dispatch = useDispatch();
    const fileInput = useRef(null);
    const [busy, setBusy] = useState(false);
    const [lightbox, setLightbox] = useState(false);

    const frame = src ? (
        <img src={src} alt="" className="h-40 w-full object-cover"/>
    ) : (
        <div className="h-40 w-full bg-gradient-to-br from-ink-800 via-ink-900 to-black flex items-center justify-center">
            <Crown className="h-8 w-8 text-volt-400/70"/>
        </div>
    );

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
            const native = await pickNativePhoto("prompt");
            if (native) {
                await send(native);
                return;
            }
        } catch (err) {
            if (isPhotoPickCancel(err)) return;
        }
        fileInput.current?.click();
    }

    return (
        <>
            <div className="relative overflow-hidden rounded-xl">
                {src ? (
                    <button type="button" onClick={() => setLightbox(true)}
                            aria-label={title ? `View ${title}` : "View Echo art"}
                            className="block w-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-volt-400">
                        {frame}
                    </button>
                ) : canUpload ? (
                    <button type="button" onClick={openPicker} disabled={busy}
                            aria-label="Add Echo art"
                            className="group relative block w-full focus:outline-none focus:ring-2 focus:ring-volt-400 disabled:opacity-80">
                        {frame}
                        <span className="absolute inset-0 bg-ink-950/45 flex flex-col items-center justify-center gap-1.5">
                            {busy
                                ? <BeatLoader size={6} color="#d7ff3e"/>
                                : (
                                    <>
                                        <Camera className="h-7 w-7 text-volt-400"/>
                                        <span className="text-[11px] font-extrabold uppercase tracking-wide text-volt-400">
                                            Add art
                                        </span>
                                    </>
                                )}
                        </span>
                    </button>
                ) : frame}
                {canUpload && src && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); openPicker(); }}
                            disabled={busy}
                            aria-label="Change Echo art"
                            className="absolute bottom-2 right-2 z-10 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-ink-950/70 text-volt-400 hover:bg-ink-950/90 transition disabled:opacity-60">
                        {busy ? <BeatLoader size={5} color="#d7ff3e"/> : <Camera className="h-5 w-5"/>}
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

async function shareEcho(echo) {
    const text = `${echo.title} · Power ${echo.power}\n${echo.narrative}`;
    try {
        if (navigator.share) {
            await navigator.share({title: echo.title, text});
            return;
        }
        await navigator.clipboard.writeText(text);
        notice("Copied the Echo to your clipboard.");
    } catch (err) {
        if (err && err.name === "AbortError") return;
        notice("Could not share this Echo.");
    }
}

function EchoCard({echo, userId, onChallenge, onDelete, busy, now}) {
    const mine = echo.holder_id === userId;
    const planted = echo.origin_id === userId;
    const war = echo.active_challenge;
    const myWar = echo.my_challenge;
    const live = echo.status === "undefeated" || echo.status === "contested";
    const canChallenge = live && !mine && !war && Boolean(userId);

    return (
        <article className={paneCardClass}>
            <EchoArt url={echo.image} title={echo.title}
                     canUpload={Boolean(echo.can_upload_art)} echoId={echo.id}/>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={"rounded-full text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 " + (STATUS_TONE[echo.status] || STATUS_TONE.retired)}>
                    {echo.status === "immortal" ? "Immortal" : echo.status === "contested" ? "Under fire" : echo.status}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-volt-700 dark:text-volt-300">
                    Power {echo.power}
                </span>
                <span className="text-[11px] text-gray-600 dark:text-gray-400">{echo.metric_label}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-ink-950/10 dark:bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-volt-400" style={{width: `${Math.max(8, Math.min(100, echo.power))}%`}}/>
            </div>
            <h3 className="mt-3 font-display text-sm uppercase tracking-wide leading-snug">{echo.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-700 dark:text-gray-300 italic">{echo.narrative}</p>
            <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
                Held by {echo.holder_name || "an athlete"}
                {planted ? " · you planted this" : echo.origin_name ? ` · planted by ${echo.origin_name}` : ""}
                {echo.chain_length > 1 ? ` · lineage ×${echo.chain_length}` : ""}
                {echo.defenses > 0 ? ` · held the line ×${echo.defenses}` : ""}
            </p>
            {war && (
                <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {war.challenger_name || "Someone"} is coming for it · {formatCountdown(war.window_end, now)} left
                    {myWar ? " · that's you" : ""}
                </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {canChallenge && (
                    <button type="button" disabled={busy}
                            onClick={() => onChallenge(echo)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-volt-400 text-ink-950 px-3.5 py-2 text-[11px] font-extrabold uppercase tracking-wide hover:bg-volt-300 transition disabled:opacity-50">
                        <Swords className="h-3.5 w-3.5"/> Challenge
                    </button>
                )}
                <button type="button" onClick={() => shareEcho(echo)}
                        className="inline-flex items-center gap-1.5 rounded-full btn-glass px-3 py-2 text-[11px] font-bold uppercase tracking-wide transition">
                    <Share2 className="h-3.5 w-3.5"/> Share
                </button>
                {echo.can_delete && (
                    <button type="button" onClick={() => onDelete(echo)} disabled={busy}
                            aria-label={`Delete ${echo.title}`}
                            className="ml-auto inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full btn-glass text-gray-400 hover:text-red-500 transition disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5"/>
                    </button>
                )}
            </div>
        </article>
    );
}

function EchoBook({competitionId, open}) {
    const {data: book} = useGetEchoBookQuery(competitionId, {skip: !open || !competitionId});
    if (!open) return null;
    if (!book) {
        return <p className="text-sm text-gray-400">Opening the chronicle…</p>;
    }
    if (!book.chapters?.length) {
        return <p className="text-sm text-gray-400">No Echoes have been planted in this challenge yet.</p>;
    }
    return (
        <ol className="space-y-3">
            {book.chapters.map((ch) => (
                <li key={ch.id} className="rounded-xl glass-well p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-volt-700 dark:text-volt-400">
                        {ch.status} · power {ch.power} · lineage ×{ch.chain_length}
                    </p>
                    <p className="mt-1 font-display text-sm uppercase">{ch.title}</p>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 italic">{ch.narrative}</p>
                    <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                        Planted by {ch.origin_name} · held by {ch.holder_name}
                    </p>
                    {(ch.wars || []).length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-[11px] text-gray-400">
                            {ch.wars.map((w, i) => (
                                <li key={`${ch.id}-${i}`}>
                                    {w.challenger} · {w.status}
                                </li>
                            ))}
                        </ul>
                    )}
                </li>
            ))}
        </ol>
    );
}

export default function EchoChamber({competitionId, userId}) {
    const poll = usePollingInterval(90000);
    const {data: echoes} = useGetEchoesQuery(
        {competition: competitionId},
        {pollingInterval: poll, skip: !competitionId},
    );
    const [challenge, {isLoading: challengeBusy}] = useChallengeEchoMutation();
    const [removeEcho, {isLoading: deleteBusy}] = useDeleteEchoMutation();
    const busy = challengeBusy || deleteBusy;
    const [bookOpen, setBookOpen] = useState(false);
    const rows = echoes || [];
    const artFirst = (a, b) => {
        const art = Number(Boolean(b.image)) - Number(Boolean(a.image));
        if (art) return art;
        return (b.power || 0) - (a.power || 0);
    };
    const live = rows.filter((e) => e.status === "undefeated" || e.status === "contested").slice().sort(artFirst);
    const immortal = rows.filter((e) => e.status === "immortal").slice().sort(artFirst);
    const ticking = live.some((e) => e.active_challenge?.window_end);
    const now = useNowTick(ticking);
    if (rows.length === 0) {
        return (
            <div>
                <PaneHead title="Echo Chamber" hint="Living trophies"/>
                <article className={paneCardClass}>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                        No Echoes yet. They are planted for a personal best in this challenge,
                        a 15 km or 90 min session, taking 1st place, or the first 40+ minute
                        workout of the challenge.
                    </p>
                </article>
            </div>
        );
    }

    async function onChallenge(echo) {
        const ok = await confirmAction(
            `Declare war on ${echo.title}? You have 7 days to beat ${echo.metric_label}. The coach will tell everyone.`,
        );
        if (!ok) return;
        try {
            await challenge(echo.id).unwrap();
        } catch (err) {
            notice(err?.data?.detail || "Could not start that challenge.");
        }
    }

    async function onDelete(echo) {
        const ok = await confirmAction(
            `Delete ${echo.title}? The trophy, its wars, and its art are gone for good.`,
        );
        if (!ok) return;
        try {
            await removeEcho(echo.id).unwrap();
        } catch (err) {
            notice(err?.data?.detail || "Could not delete that Echo.");
        }
    }

    return (
        <div>
            <PaneHead title="Echo Chamber" hint="Living trophies. Undefeated ones taunt the group until someone claims them.">
                <button type="button" onClick={() => setBookOpen((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 transition">
                    <ScrollText className="h-3.5 w-3.5"/>
                    {bookOpen ? "Hide book" : "Book of Echoes"}
                </button>
            </PaneHead>
            {bookOpen && (
                <article className={paneCardClass + " mb-3"}>
                    <EchoBook competitionId={competitionId} open={bookOpen}/>
                </article>
            )}
            {live.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                    {live.map((echo) => (
                        <EchoCard key={echo.id} echo={echo} userId={userId} now={now}
                                  onChallenge={onChallenge} onDelete={onDelete} busy={busy}/>
                    ))}
                </div>
            )}
            {immortal.length > 0 && (
                <div className="mt-4">
                    <PaneHead title="Immortal"/>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {immortal.map((echo) => (
                            <EchoCard key={echo.id} echo={echo} userId={userId} now={now}
                                      onChallenge={onChallenge} onDelete={onDelete} busy={busy}/>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

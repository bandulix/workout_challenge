import React, {useState} from "react";

function dateLabel(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "the final day";
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
}

function safePercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number));
}

export default function ExpeditionPostcard({title, finale, canRematch = false, onRematch}) {
    const [shareMessage, setShareMessage] = useState("");
    if (finale?.status !== "final") return null;

    const challengeTitle = title || "Shared challenge";
    const progress = safePercent(finale.group_progress_percent);
    const participants = Math.max(0, Number.parseInt(finale.participant_count, 10) || 0);
    const date = dateLabel(finale.final_date);
    const shareText = `${challengeTitle} finished on ${date}: ${progress}% of the shared route completed together by ${participants} participants.`;

    async function sharePostcard() {
        try {
            if (typeof navigator.share === "function") {
                await navigator.share({title: `${challengeTitle} · Expedition finale`, text: shareText});
                setShareMessage("Postcard shared.");
            } else if (typeof navigator.clipboard?.writeText === "function") {
                await navigator.clipboard.writeText(shareText);
                setShareMessage("Postcard summary copied.");
            } else {
                setShareMessage("Sharing is unavailable on this device.");
            }
        } catch (error) {
            if (error?.name === "AbortError") return;
            setShareMessage("The postcard could not be shared. You can still copy the preview text.");
        }
    }

    return (
        <section
            aria-label="Expedition postcard preview"
            className="mt-5 rounded-2xl border border-emerald-700/30 bg-emerald-50 p-4 dark:border-emerald-400/30 dark:bg-emerald-950/30"
        >
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-200">Expedition finale · preview</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{challengeTitle}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">Finished {date}</p>
            <div className="mt-3 rounded-xl border border-emerald-800/15 bg-white/70 p-3 dark:border-white/10 dark:bg-black/10">
                <p className="font-semibold text-slate-900 dark:text-white">{progress}% of the shared route</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">Completed together by {participants} participants</p>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">This preview leaves out individual activity and personal progress.</p>
            <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={sharePostcard}
                    className="min-h-[44px] rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600">
                    Share postcard
                </button>
                {canRematch && onRematch && (
                    <button type="button" onClick={onRematch}
                        className="min-h-[44px] rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                        Prepare a rematch
                    </button>
                )}
            </div>
            {canRematch && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    A fresh challenge is only created after you review and confirm it. Previous members are not added automatically; invite the group explicitly.
                </p>
            )}
            {shareMessage && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" role="status">{shareMessage}</p>}
        </section>
    );
}

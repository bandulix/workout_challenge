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
            className="mt-5 rounded-3xl glass-card p-4 text-ink-950 dark:text-white"
        >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-white/55">Expedition finale · preview</p>
            <h3 className="mt-1 font-display text-sm uppercase tracking-wider">{challengeTitle}</h3>
            <p className="text-sm text-muted">Finished {date}</p>
            <div className="mt-3 rounded-2xl bg-ink-950/5 p-3 dark:bg-white/5">
                <p className="font-display text-base tabular-nums text-volt-700 dark:text-volt-300">{progress}% of the shared route</p>
                <p className="text-sm text-muted">Completed together by {participants} participants</p>
            </div>
            <p className="mt-2 text-xs text-muted">This preview leaves out individual activity and personal progress.</p>
            <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={sharePostcard}
                    className="min-h-[44px] btn-plate px-4 py-2 text-sm font-bold">
                    Share postcard
                </button>
                {canRematch && onRematch && (
                    <button type="button" onClick={onRematch}
                        className="btn-plate-ink min-h-[44px] px-4 py-2 text-sm font-semibold">
                        Prepare a rematch
                    </button>
                )}
            </div>
            {canRematch && (
                <p className="mt-2 text-xs text-muted">
                    A fresh challenge is only created after you review and confirm it. Previous members are not added automatically; invite the group explicitly.
                </p>
            )}
            {shareMessage && <p className="mt-2 text-sm text-muted" role="status">{shareMessage}</p>}
        </section>
    );
}

import React, {useState} from "react";
import {useNavigate} from "react-router-dom";
import {OverlaySheet} from "../forms/basicComponents";
import {workoutTypes} from "../utils/sports";
import {useCreateDuelMutation} from "../utils/reducers/duelsSlice";
import {errText} from "../utils/errors";
import {toast} from "../utils/toasts";

const DURATIONS = [3, 7, 14];

function metricPayload(metricKey) {
    if (metricKey === "minutes") return {metric: "minutes", sport_type: ""};
    if (metricKey.startsWith("sport:")) return {metric: "sport", sport_type: metricKey.slice(6)};
    return {metric: "points", sport_type: ""};
}

export default function DuelSheet({competitionId, opponentId, opponentName, onClose}) {
    const navigate = useNavigate();
    const [createDuel, {isLoading}] = useCreateDuelMutation();
    const [duration, setDuration] = useState(7);
    const [metricKey, setMetricKey] = useState("points");
    const [forfeit, setForfeit] = useState("");
    const [forfeitPublic, setForfeitPublic] = useState(false);
    const [feedOptIn, setFeedOptIn] = useState(false);
    const [error, setError] = useState("");
    const name = opponentName ? `@${opponentName}` : "them";

    async function send(event) {
        event.preventDefault();
        setError("");
        try {
            const duel = await createDuel({
                competitionId,
                opponent_id: opponentId,
                duration_days: duration,
                forfeit: forfeit.trim(),
                forfeit_public: forfeitPublic,
                feed_opt_in: feedOptIn,
                ...metricPayload(metricKey),
            }).unwrap();
            toast.success(`Challenge sent to ${name}.`);
            onClose();
            if (duel?.id) navigate(`/duel/${duel.id}`);
        } catch (err) {
            setError(errText(err, "Could not send the challenge."));
        }
    }

    return (
        <OverlaySheet title={`Duel ${name}`} onClose={onClose} labelledBy="duel-sheet-title">
            <form onSubmit={send} className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                    A private head-to-head. Only the two of you see the score, and a loss stays between you.
                </p>
                <fieldset>
                    <legend className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Duration</legend>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                        {DURATIONS.map((days) => (
                            <button
                                key={days}
                                type="button"
                                aria-pressed={duration === days}
                                onClick={() => setDuration(days)}
                                className={"min-h-[44px] rounded-xl px-2 text-sm font-bold " + (duration === days ? "btn-plate" : "btn-plate-ink")}
                            >
                                {days} days
                            </button>
                        ))}
                    </div>
                </fieldset>
                <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted">What counts</span>
                    <select
                        value={metricKey}
                        onChange={(event) => setMetricKey(event.target.value)}
                        className="mt-2 min-h-[44px] w-full rounded-xl border border-white/15 bg-white/80 px-3 text-sm text-ink-950 dark:bg-ink-950/80 dark:text-white"
                    >
                        <option value="points">Challenge points</option>
                        <option value="minutes">Minutes</option>
                        {Object.entries(workoutTypes).map(([key, labels]) => (
                            <option key={key} value={`sport:${key}`}>{labels.label}</option>
                        ))}
                    </select>
                    <span className="mt-1 block text-xs text-muted">Same scoring as the board: 1 point per 1% of a goal.</span>
                </label>
                <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Forfeit, if you want one</span>
                    <textarea
                        value={forfeit}
                        maxLength={200}
                        rows={2}
                        placeholder="Loser buys the beers"
                        onChange={(event) => setForfeit(event.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/15 bg-white/80 px-3 py-2 text-sm text-ink-950 dark:bg-ink-950/80 dark:text-white"
                    />
                    <span className="mt-1 block text-xs text-muted">
                        Words only. The app records what you both agree. It never moves money.
                    </span>
                </label>
                <label className="flex min-h-[44px] items-center gap-3 text-sm">
                    <input type="checkbox" checked={forfeitPublic} onChange={(event) => setForfeitPublic(event.target.checked)}/>
                    Show the forfeit if we both agree
                </label>
                <label className="flex min-h-[44px] items-center gap-3 text-sm">
                    <input type="checkbox" checked={feedOptIn} onChange={(event) => setFeedOptIn(event.target.checked)}/>
                    Post the result to the challenge feed if they agree too
                </label>
                {error && <p className="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p>}
                <button type="submit" disabled={isLoading} className="min-h-[44px] w-full btn-plate px-4 text-sm font-bold">
                    {isLoading ? "Sending…" : "Send the challenge"}
                </button>
            </form>
        </OverlaySheet>
    );
}

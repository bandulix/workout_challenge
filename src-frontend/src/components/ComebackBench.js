import React, {useState} from "react";
import {Footprints, HandHeart, PartyPopper} from "lucide-react";
import {
    useCreateComebackSupportOfferMutation,
    useGetComebackBenchQuery,
    useRespondToComebackSupportOfferMutation,
    useUpdateComebackBenchMutation,
} from "../utils/reducers/drillInstructorSlice";

function activityLabel(count) {
    return `${count} ${count === 1 ? "activity" : "activities"}`;
}

const offerCopy = {
    cheer: "A gentle cheer, at whatever pace feels right.",
    workout: "A teammate is open to doing an easy activity together.",
    check_in: "A teammate offered a low-pressure check-in.",
};
// One icon per offer kind: the switch shows them so people can see what
// "open to a nudge" can turn into before they flip it.
const offerKinds = [
    ["cheer", "A gentle cheer", PartyPopper],
    ["workout", "An easy activity together", Footprints],
    ["check_in", "A low-pressure check-in", HandHeart],
];

function OfferKindIcons({className = ""}) {
    return (
        <span className={"inline-flex items-center gap-1 " + className} aria-hidden="true">
            {offerKinds.map(([value, , Icon]) => (
                <span key={value} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink-950/5 text-gray-700 dark:bg-white/10 dark:text-white/80">
                    <Icon className="h-3.5 w-3.5"/>
                </span>
            ))}
        </span>
    );
}
const offerStatusCopy = {
    pending: "awaiting their choice",
    accepted: "accepted",
    declined: "declined",
};

// Home card: the private "Your own pace" prompt plus any pending support
// offers. It renders nothing when there is nothing to say. The controls
// live in Settings -> Comeback (see ComebackPreferences below).
export default function ComebackBench() {
    const {data, isLoading} = useGetComebackBenchQuery();
    const [updatePreferences, {isLoading: isSaving}] = useUpdateComebackBenchMutation();
    const [respondToOffer, {isLoading: isResponding}] = useRespondToComebackSupportOfferMutation();

    if (isLoading || !data) return null;

    const currentCount = data.current_period?.workout_count ?? 0;
    const previousCount = data.previous_period?.workout_count ?? 0;
    const incomingOffers = data.incoming_offers || [];
    const outgoingOffers = data.outgoing_offers || [];
    if (!data.prompt_visible && incomingOffers.length === 0 && outgoingOffers.length === 0) return null;

    return (
        <section className="mb-4 rounded-xl border border-ink-950/10 bg-white p-4 text-ink-950 shadow-sm dark:border-white/10 dark:bg-ink-900 dark:text-white"
                 aria-label="Private comeback bench">
            {data.prompt_visible && (
                <div className="mb-3">
                    <h2 className="text-base font-bold">Your own pace</h2>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                        This week: {activityLabel(currentCount)} · last week: {activityLabel(previousCount)}.
                    </p>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{data.return_action}</p>
                    <button type="button" onClick={() => updatePreferences({dismiss_for_days: 7})}
                            disabled={isSaving}
                            className="mt-3 inline-flex min-h-[44px] items-center rounded-full border border-ink-950/20 px-4 py-2 text-xs font-bold uppercase tracking-wide hover:bg-ink-950/5 dark:border-white/20 dark:hover:bg-white/10">
                        Dismiss for a week
                    </button>
                </div>
            )}

            {incomingOffers.length > 0 && (
                <div className="mb-3 rounded-lg border border-ink-950/10 dark:border-white/15 p-3" aria-label="Private support offers">
                    <h3 className="text-sm font-bold">Private support offers</h3>
                    <ul className="mt-2 space-y-3">
                        {incomingOffers.map((offer) => (
                            <li key={offer.id} className="text-sm">
                                <p><strong>{offer.sender_first_name}</strong> offered: {offerCopy[offer.offer_kind] || offerCopy.cheer}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    <button type="button" disabled={isResponding}
                                            onClick={() => respondToOffer({offerId: offer.id, accepted: true})}
                                            aria-label={`Accept support offer from ${offer.sender_first_name}`}
                                            className="inline-flex min-h-[44px] items-center btn-plate px-4 py-2 text-xs font-bold">
                                        Accept
                                    </button>
                                    <button type="button" disabled={isResponding}
                                            onClick={() => respondToOffer({offerId: offer.id, accepted: false})}
                                            aria-label={`Decline support offer from ${offer.sender_first_name}`}
                                            className="inline-flex min-h-[44px] items-center rounded-full border border-ink-950/20 px-4 py-2 text-xs font-bold uppercase tracking-wide dark:border-white/20">
                                        Decline
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {outgoingOffers.length > 0 && (
                <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                    {outgoingOffers.map((offer) => (
                        <span key={offer.id} className="mr-3">
                            Support offer to {offer.recipient_first_name}: {offerStatusCopy[offer.status] || offer.status}.
                        </span>
                    ))}
                </p>
            )}

        </section>
    );
}

// Settings -> Comeback: prompts on/off, the "open to a nudge" opt-in and
// sending an offer to an opted-in challenge-mate.
export function ComebackPreferences() {
    const {data, isLoading} = useGetComebackBenchQuery();
    const [updatePreferences, {isLoading: isSaving}] = useUpdateComebackBenchMutation();
    const [createOffer, {isLoading: isCreatingOffer}] = useCreateComebackSupportOfferMutation();
    const [selectedPeer, setSelectedPeer] = useState("");
    const [offerKind, setOfferKind] = useState("cheer");

    if (isLoading || !data) return null;

    const {preferences = {}} = data;
    const supportPeers = data.support_peers || [];
    const peerValue = (peer) => `${peer.id}:${peer.competition_id}`;
    const selectedValue = supportPeers.some((peer) => peerValue(peer) === selectedPeer)
        ? selectedPeer
        : (supportPeers[0] ? peerValue(supportPeers[0]) : "");

    function sendSupportOffer() {
        const [recipientId, competitionId] = selectedValue.split(":").map(Number);
        if (!recipientId || !competitionId) return;
        createOffer({recipient_id: recipientId, competition_id: competitionId, offer_kind: offerKind});
    }

    return (
        <section aria-label="Comeback preferences" className="text-ink-950 dark:text-white">
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
                When a week goes quiet, a private note shows up on your home page. Nobody else sees it.
            </p>
            <div className="space-y-4">
            <button type="button"
                    onClick={() => updatePreferences({prompts_enabled: !preferences.prompts_enabled})}
                    disabled={isSaving}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-ink-950/20 px-4 py-2 text-xs font-bold uppercase tracking-wide hover:bg-ink-950/5 dark:border-white/20 dark:hover:bg-white/10">
                {preferences.prompts_enabled ? "Mute prompts" : "Turn prompts on"}
            </button>
            <label className="flex min-h-[44px] items-start gap-2 text-sm">
                <input type="checkbox" checked={Boolean(preferences.support_opt_in)} disabled={isSaving}
                       aria-describedby="comeback-support-hint"
                       onChange={(event) => updatePreferences({support_opt_in: event.currentTarget.checked})}
                       className="mt-1"/>
                <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                        Let challenge-mates know I'm open to a nudge
                        <OfferKindIcons/>
                    </span>
                    <span id="comeback-support-hint" className="text-xs text-gray-500 dark:text-gray-400">
                        They see your first name only, and can send a cheer, an easy-workout invite, or a check-in. You accept or ignore.
                    </span>
                </span>
            </label>
            {preferences.support_opt_in && (
                <div className="space-y-2">
                    {supportPeers.length > 0 ? (
                        <div className="flex flex-wrap items-end gap-2">
                            <label className="flex min-w-[12rem] flex-col gap-1 text-xs font-semibold">
                                Teammate
                                <select aria-label="Teammate" value={selectedValue}
                                        onChange={(event) => setSelectedPeer(event.currentTarget.value)}
                                        className="min-h-[44px] rounded-lg border border-ink-950/20 bg-transparent px-3 text-sm dark:border-white/20">
                                    {supportPeers.map((peer) => (
                                        <option key={peerValue(peer)} value={peerValue(peer)}>
                                            {peer.first_name} · {peer.competition_name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex min-w-[12rem] flex-col gap-1 text-xs font-semibold">
                                Offer
                                <select aria-label="Support offer type" value={offerKind}
                                        onChange={(event) => setOfferKind(event.currentTarget.value)}
                                        className="min-h-[44px] rounded-lg border border-ink-950/20 bg-transparent px-3 text-sm dark:border-white/20">
                                    {offerKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                            </label>
                            <button type="button" onClick={sendSupportOffer}
                                    disabled={isCreatingOffer || !selectedValue}
                                    className="inline-flex min-h-[44px] items-center btn-plate px-4 py-2 text-xs font-bold">
                                Offer support
                            </button>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400">No teammates in an active challenge are accepting offers right now.</p>
                    )}
                </div>
            )}
        </div>
        </section>
    );
}

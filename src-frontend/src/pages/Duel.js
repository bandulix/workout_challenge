import React, {useState} from "react";
import {Link, useNavigate, useParams} from "react-router-dom";
import {PageWrapper} from "../utils/miscellaneous";
import {errText} from "../utils/errors";
import usePollingInterval from "../utils/usePollingInterval";
import {
    useForfeitDuelMutation,
    useGetDuelQuery,
    useRematchDuelMutation,
    useRespondDuelMutation,
} from "../utils/reducers/duelsSlice";
import DuelView from "../components/DuelView";
import {toast} from "../utils/toasts";

export default function Duel() {
    const {id} = useParams();
    const navigate = useNavigate();
    const poll = usePollingInterval(30000);
    const {data, error, isLoading} = useGetDuelQuery(id, {skip: !id, pollingInterval: poll});
    const [respond, respondState] = useRespondDuelMutation();
    const [forfeit, forfeitState] = useForfeitDuelMutation();
    const [rematch, rematchState] = useRematchDuelMutation();
    const [actionError, setActionError] = useState("");
    const busy = respondState.isLoading || forfeitState.isLoading || rematchState.isLoading;

    async function run(work, ok) {
        setActionError("");
        try {
            const next = await work().unwrap();
            if (ok) toast.success(ok);
            if (next?.id && String(next.id) !== String(id)) navigate(`/duel/${next.id}`);
        } catch (err) {
            setActionError(errText(err, "That did not go through."));
        }
    }

    return (
        <PageWrapper>
            <div className="container mx-auto max-w-lg p-4 pb-28">
                <Link to="/dashboard" className="mb-3 inline-flex min-h-[44px] items-center text-sm font-semibold">Back home</Link>
                {isLoading && !data && <p className="text-sm text-muted" role="status">Loading the duel…</p>}
                {error && <p className="text-sm text-red-600 dark:text-red-300" role="alert">{errText(error, "This duel is not available.")}</p>}
                {data && (
                    <DuelView
                        duel={data}
                        busy={busy}
                        error={actionError}
                        onAccept={(flags) => run(() => respond({id, action: "accept", ...flags}), "Duel on.")}
                        onDecline={() => run(() => respond({id, action: "decline"}), "Declined.")}
                        onWithdraw={() => run(() => respond({id, action: "withdraw"}), "Withdrawn.")}
                        onCounter={(body) => run(() => respond({id, action: "counter", ...body}), "Counter sent.")}
                        onMarkPaid={() => run(() => forfeit({id, action: "mark_paid"}), "Marked paid.")}
                        onConfirm={() => run(() => forfeit({id, action: "confirm"}), "Confirmed.")}
                        onRematch={() => run(() => rematch(id), "Rematch sent.")}
                    />
                )}
            </div>
        </PageWrapper>
    );
}

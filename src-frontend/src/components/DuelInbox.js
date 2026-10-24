import React from "react";
import {Link} from "react-router-dom";
import {useGetMyDuelsQuery} from "../utils/reducers/duelsSlice";
import {recordLabel} from "../utils/duel";

const OPEN = new Set(["pending", "countered", "active"]);

export function DuelRecordLine({record, className = ""}) {
    const label = recordLabel(record);
    if (!label) return null;
    return <p className={"text-xs text-muted " + className}>Duels {label}</p>;
}

export default function DuelInbox() {
    const {data} = useGetMyDuelsQuery();
    const rows = (data?.results || []).filter((duel) => OPEN.has(duel.status));
    if (!rows.length) return null;
    return (
        <section aria-label="Your duels" className="mb-4 rounded-3xl glass-card p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Duels</p>
            <ul className="mt-2 divide-y divide-white/10">
                {rows.map((duel) => {
                    const who = duel.them?.username ? `@${duel.them.username}` : "them";
                    const state = duel.awaiting_you
                        ? `Reply to ${who}`
                        : duel.status === "active"
                            ? `Live vs ${who}`
                            : `Waiting on ${who}`;
                    return (
                        <li key={duel.id}>
                            <Link to={`/duel/${duel.id}`} className="flex min-h-[44px] items-center justify-between gap-3 text-sm font-semibold no-underline">
                                <span>{state}</span>
                                <span className="text-xs text-muted">{duel.duration_days}d · {duel.metric_label}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

import React, {useState} from "react";
import {Minus, Plus, Share2, X} from "lucide-react";
import {shareText} from "../utils/skiweek";
import {skiLocale, skiT} from "../utils/skiI18n";

const PILLS = [
    {id: "punkte", key: "points"},
    {id: "piste", key: "piste"},
    {id: "sambuca", key: "sambuca"},
];

function pillValue(row, pill) {
    if (pill === "sambuca") return row.sambuca;
    if (pill === "piste") return Math.round(row.elevation_m || 0);
    return Math.round(row.punkte || 0);
}

export function ApresBoard({skiweek, lang = "en"}) {
    const [scope, setScope] = useState("day");
    const [pill, setPill] = useState("sambuca");
    const rows = (scope === "week" ? skiweek?.board?.week : skiweek?.board?.day) || [];
    return (
        <section className="skiweek skiweek-board" aria-label="Après board">
            <div className="ski-hero-top">
                <p className="ski-kicker">Après · {skiweek?.resort?.name}</p>
                <div className="ski-scope">
                    <button type="button" aria-pressed={scope === "day"} onClick={() => setScope("day")}>{skiT(lang, "day")}</button>
                    <button type="button" aria-pressed={scope === "week"} onClick={() => setScope("week")}>{skiT(lang, "week")}</button>
                </div>
            </div>
            <div className="ski-pills" role="tablist">
                {PILLS.map((item) => (
                    <button key={item.id} type="button" role="tab" aria-selected={pill === item.id} onClick={() => setPill(item.id)}>
                        {skiT(lang, item.key)}
                    </button>
                ))}
            </div>
            <ol className="ski-board">
                {rows.length === 0 && <li className="ski-meta">{skiT(lang, "emptyBoard")}</li>}
                {rows.map((row, index) => (
                    <li key={row.user_id}>
                        <span>{index + 1}</span>
                        <span>{row.username}</span>
                        <strong>{pillValue(row, pill)}</strong>
                    </li>
                ))}
            </ol>
        </section>
    );
}

export function SambucaSheet({skiweek, busy, onClose, onAdd, onUndo, lang = "en"}) {
    const mine = skiweek?.today?.sambuca_mine || 0;
    const logs = (skiweek?.today?.logs || []).filter((row) => row.kind === "sambuca");
    return (
        <div className="ski-sheet-back" role="presentation" onClick={onClose}>
            <section className="skiweek ski-sheet" role="dialog" aria-label="Sambuca" onClick={(event) => event.stopPropagation()}>
                <div className="ski-hero-top">
                    <p className="ski-kicker">{skiT(lang, "sambuca")}</p>
                    <button type="button" className="ski-share" onClick={onClose} aria-label="Close">
                        <X className="h-4 w-4"/>
                    </button>
                </div>
                <p className="ski-num ski-sheet-num">{mine}</p>
                <div className="ski-stepper">
                    <button type="button" className="ski-share" aria-label="Undo last" disabled={busy || logs.length === 0} onClick={onUndo}>
                        <Minus className="h-4 w-4"/>
                    </button>
                    <button type="button" className="ski-share" aria-label="Add one" disabled={busy} onClick={() => onAdd(1)}>
                        <Plus className="h-4 w-4"/>
                    </button>
                </div>
                <div className="ski-quick">
                    {[1, 2, 3].map((amount) => (
                        <button key={amount} type="button" disabled={busy} onClick={() => onAdd(amount)}>+{amount}</button>
                    ))}
                </div>
                <ul className="ski-logs">
                    {logs.map((row) => (
                        <li key={row.id}><span>+{row.amount}</span><span>{row.logged_at?.slice(11, 16)}</span></li>
                    ))}
                </ul>
            </section>
        </div>
    );
}

export function ChampReveal({skiweek, onClose, lang = "en"}) {
    const crown = skiweek?.yesterday || (skiweek?.wearing?.length ? {
        users: skiweek.wearing,
        count: skiweek.wearing[0]?.count,
        resort_day: skiweek.wearing[0]?.resort_day,
        tied: skiweek.wearing.length > 1,
    } : null);
    if (!crown) return null;
    const names = (crown.users || []).map((user) => user.username).filter(Boolean);
    const line = names.length
        ? (skiLocale(lang) === "de"
            ? (names.length > 1
                ? `${names.join(" und ")} teilen sich die Krone${crown.count ? ` · ${crown.count}` : ""}.`
                : `${names[0]} trägt die Krone${crown.count ? ` · ${crown.count}` : ""}.`)
            : `${names.join(" and ")} ${names.length > 1 ? "share" : "wears"} the crown${crown.count ? ` · ${crown.count}` : ""}.`)
        : skiT(lang, "crownOpen");
    async function share() {
        const text = `${skiweek?.resort?.name || "Skiwoche"}: ${line}`;
        if (navigator.share) {
            try { await navigator.share({title: "Sambuca crown", text}); return; } catch (err) { if (err?.name === "AbortError") return; }
        }
        try { await navigator.clipboard.writeText(text); } catch { /* the line stays on screen */ }
    }
    return (
        <div className="ski-sheet-back" role="presentation">
            <section className="skiweek ski-champ" role="dialog" aria-label="Sambuca crown">
                <p className="ski-kicker">{skiweek?.resort?.name}</p>
                <h2 className="ski-open">Crown</h2>
                <p className="ski-num">{crown.count || 0}</p>
                <p>{line}</p>
                <p className="ski-meta">{crown.resort_day}</p>
                <button type="button" className="ski-share" onClick={share}><Share2 className="h-4 w-4"/> Share</button>
                <button type="button" className="ski-share" onClick={onClose}>Close</button>
            </section>
        </div>
    );
}

export function crownShareLine(skiweek) {
    return shareText(skiweek);
}

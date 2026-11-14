import React, {useState} from "react";
import {Camera, Image as ImageIcon, Minus, Plus, Share2, X} from "lucide-react";
import {shareText} from "../utils/skiweek";
import {skiLocale, skiT} from "../utils/skiI18n";
import {useProtectedImage} from "../utils/protectedMedia";

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

export function ApresBoard({skiweek, lang = "en", onUpload}) {
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
            <SkiPhotoStudio skiweek={skiweek} lang={lang} onUpload={onUpload}/>
        </section>
    );
}

function shareCard(title, text) {
    if (navigator.share) {
        navigator.share({title, text}).catch((err) => {
            if (err?.name === "AbortError") return;
            navigator.clipboard?.writeText(text).catch(() => {});
        });
        return;
    }
    navigator.clipboard?.writeText(text).catch(() => {});
}

function SkiFrame({card, lang, label, onShare}) {
    const {src} = useProtectedImage(card?.image || null, "card");
    if (!card) return null;
    return (
        <figure className="ski-frame">
            {src && <img src={src} alt={label}/>}
            <figcaption>
                <p>{card.body}</p>
                {card.fallback && <p className="ski-meta">{skiT(lang, "photoReady")}</p>}
                {onShare && (
                    <button type="button" className="ski-share" onClick={() => onShare(card.body || label)}>
                        <Share2 className="h-4 w-4"/> {skiT(lang, "share")}
                    </button>
                )}
            </figcaption>
        </figure>
    );
}

function PhotoPick({label, ready, onFile, icon}) {
    return (
        <label className={"ski-pick" + (ready ? " is-ready" : "")}>
            {icon}
            <span>{ready ? `${label} · ${ready}` : label}</span>
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
            }}/>
        </label>
    );
}

export function SkiPhotoStudio({skiweek, lang = "en", onUpload}) {
    const [slope, setSlope] = useState(null);
    const [evening, setEvening] = useState(null);
    const cards = skiweek?.cards || {};
    const ready = skiT(lang, "ready");
    return (
        <div className="ski-photos">
            <p className="ski-kicker">{skiT(lang, "hutTitle")}</p>
            <p className="ski-meta">{skiT(lang, "hutHint")}</p>
            {(cards.huts || []).map((card) => (
                <SkiFrame key={card.id} card={card} lang={lang} label={skiT(lang, "hutTitle")}
                          onShare={(text) => shareCard(skiT(lang, "hutTitle"), text)}/>
            ))}
            {onUpload && (
                <PhotoPick label={skiT(lang, "hutTitle")} icon={<Camera className="h-5 w-5"/>}
                           onFile={(file) => onUpload("hut", [file])}/>
            )}
            <p className="ski-kicker">{skiT(lang, "splitTitle")}</p>
            <p className="ski-meta">{skiT(lang, "splitHint")}</p>
            <SkiFrame card={cards.split} lang={lang} label={skiT(lang, "splitTitle")}
                      onShare={(text) => shareCard(skiT(lang, "splitTitle"), text)}/>
            {onUpload && (
                <div className="ski-picks">
                    <PhotoPick label={skiT(lang, "slopePhoto")} ready={slope ? ready : ""} icon={<ImageIcon className="h-5 w-5"/>}
                               onFile={(file) => {
                                   setSlope(file);
                                   if (evening) onUpload("split", [file, evening]);
                               }}/>
                    <PhotoPick label={skiT(lang, "eveningPhoto")} ready={evening ? ready : ""} icon={<ImageIcon className="h-5 w-5"/>}
                               onFile={(file) => {
                                   setEvening(file);
                                   if (slope) onUpload("split", [slope, file]);
                               }}/>
                </div>
            )}
        </div>
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
                    <button type="button" className="ski-share" onClick={onClose} aria-label={skiT(lang, "close")}>
                        <X className="h-4 w-4"/>
                    </button>
                </div>
                <p className="ski-num ski-sheet-num">{mine}</p>
                <div className="ski-stepper">
                    <button type="button" className="ski-share" aria-label={skiT(lang, "undo")} disabled={busy || logs.length === 0} onClick={onUndo}>
                        <Minus className="h-4 w-4"/>
                    </button>
                    <button type="button" className="ski-share" aria-label={skiT(lang, "addOne")} disabled={busy} onClick={() => onAdd(1)}>
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

export function ChampReveal({skiweek, onClose, onSelfie, lang = "en"}) {
    const crown = skiweek?.yesterday || (skiweek?.wearing?.length ? {
        users: skiweek.wearing,
        count: skiweek.wearing[0]?.count,
        resort_day: skiweek.wearing[0]?.resort_day,
        tied: skiweek.wearing.length > 1,
    } : null);
    if (!crown) return null;
    const names = (crown.users || []).map((user) => user.username).filter(Boolean);
    const joined = skiLocale(lang) === "de" ? names.join(" und ") : names.join(" and ");
    const line = names.length
        ? skiT(lang, names.length > 1 ? "shareCrown" : "wearsCrown", {names: joined, count: crown.count || 0})
        : skiT(lang, "crownOpen");
    const dayIndex = champDayIndex(skiweek, crown.resort_day);
    const title = dayIndex
        ? `${skiT(lang, "champTitle")} · ${skiT(lang, "dayN", {n: dayIndex})}`
        : skiT(lang, "champTitle");
    return (
        <div className="ski-sheet-back" role="presentation">
            <section className="skiweek ski-champ" role="dialog" aria-label={title}>
                <p className="ski-kicker">{skiweek?.resort?.name}</p>
                <h2 className="ski-open">{title}</h2>
                <p>{line}</p>
                <SkiFrame card={skiweek?.cards?.coronation} lang={lang} label={skiT(lang, "coronation")}/>
                {onSelfie && (
                    <PhotoPick label={skiT(lang, "selfie")} icon={<Camera className="h-5 w-5"/>} onFile={onSelfie}/>
                )}
                <button type="button" className="ski-share" onClick={() => shareCard(title, `${skiweek?.resort?.name || ""}: ${line}`)}>
                    <Share2 className="h-4 w-4"/> {skiT(lang, "share")}
                </button>
                <button type="button" className="ski-share" onClick={onClose}>{skiT(lang, "close")}</button>
            </section>
        </div>
    );
}

function champDayIndex(skiweek, iso) {
    const start = skiweek?.starts_at?.slice(0, 10);
    if (!start || !iso) return null;
    const ms = Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
    if (!Number.isFinite(ms)) return null;
    return Math.round(ms / 86400000) + 1;
}

export function crownShareLine(skiweek) {
    return shareText(skiweek);
}

export function SkiFinale({skiweek, lang = "en"}) {
    const awards = skiweek?.awards || [];
    const royalty = awards.filter((row) => row.kind === "sambuca_royalty");
    const rest = awards.filter((row) => row.kind !== "sambuca_royalty");
    return (
        <section className="skiweek skiweek-hero" aria-label={skiT(lang, "finale")}>
            <p className="ski-kicker">{skiweek?.resort?.name}</p>
            <h2 className="ski-open">{skiT(lang, "finale")}</h2>
            <ol className="ski-board">
                {royalty.map((row, index) => (
                    <li key={`royalty-${row.user_id}`}>
                        <span>{index + 1}</span>
                        <span>{row.username}</span>
                        <strong>{skiT(lang, "sambuca_royalty")} · {Math.round(row.value)}</strong>
                    </li>
                ))}
            </ol>
            <p className="ski-kicker">{skiT(lang, "awards")}</p>
            <ul className="ski-board">
                {rest.map((row) => (
                    <li key={`${row.kind}-${row.user_id}`}>
                        <span>{skiT(lang, row.kind)}</span>
                        <span>{row.username}</span>
                        <strong>{row.detail}</strong>
                    </li>
                ))}
            </ul>
        </section>
    );
}

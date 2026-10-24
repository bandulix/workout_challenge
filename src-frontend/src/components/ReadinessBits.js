import React, {useMemo, useState} from "react";
import {OverlaySheet} from "../forms/basicComponents";
import {HomeOrderCard, HomePulse, ReadinessRing} from "./polishBits";
import {confirmAction} from "../utils/dialogs";
import {toast} from "../utils/toasts";
import {errText} from "../utils/errors";
import {isNativeHealthAvailable, requestRecoveryAuthorization} from "../utils/nativeHealth";
import {
    BAND_LABEL,
    READINESS_DISCLAIMER,
    bandEdge,
    clockToMinute,
    minuteToClock,
    orderForHome,
    timezoneChoices,
} from "../utils/readinessTheme";
import {
    useDeleteReadinessDataMutation,
    useGetReadinessTodayQuery,
    useSaveCheckInMutation,
    useSaveReadinessPreferencesMutation,
} from "../utils/reducers/readinessSlice";

function TrendRow({label, values, format}) {
    const nums = values.map((value) => (value == null ? null : Number(value)));
    const peak = Math.max(1, ...nums.filter((value) => value != null && value > 0));
    return (
        <div>
            <p className="text-xs font-bold text-ink-950 dark:text-white">{label}</p>
            <div className="mt-1 flex h-10 items-end gap-1" aria-hidden="true">
                {nums.map((value, index) => {
                    const height = value == null || value <= 0 ? 8 : Math.max(8, Math.round((value / peak) * 40));
                    return (
                        <span key={index} className="readiness-bar flex-1 rounded-sm bg-ink-950/20 dark:bg-white/25"
                              style={{height, background: value == null ? undefined : bandEdge("green")}}/>
                    );
                })}
            </div>
            <p className="mt-1 text-xs text-muted">{format(nums[nums.length - 1])}</p>
        </div>
    );
}

export function TrendChart({trend = []}) {
    const sleep = (minutes) => {
        if (minutes == null) return "No sleep yet";
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return mins ? `${hours}h${String(mins).padStart(2, "0")} last night` : `${hours}h last night`;
    };
    return (
        <div className="grid grid-cols-2 gap-3">
            <TrendRow label="HRV" values={trend.map((day) => day.hrv_ms)} format={(value) => value == null ? "No HRV yet" : `${Math.round(value)} ms`}/>
            <TrendRow label="Resting HR" values={trend.map((day) => day.resting_hr)} format={(value) => value == null ? "No resting HR yet" : `${Math.round(value)} bpm`}/>
            <TrendRow label="Sleep" values={trend.map((day) => day.sleep_minutes)} format={sleep}/>
            <TrendRow label="Load" values={trend.map((day) => day.load)} format={(value) => value == null ? "No load yet" : `${value}`}/>
        </div>
    );
}

function ChoiceRow({label, hint, value, max, onPick}) {
    return (
        <div>
            <p className="text-sm font-bold text-ink-950 dark:text-white">{label}</p>
            {hint && <p className="text-xs text-muted">{hint}</p>}
            <div className="mt-2 flex gap-2">
                {Array.from({length: max}, (_, index) => index + 1).map((n) => (
                    <button key={n} type="button" onClick={() => onPick(n)}
                            aria-pressed={value === n}
                            className={"inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-sm font-bold " +
                                (value === n
                                    ? "bg-ink-950 text-white dark:bg-white dark:text-ink-950"
                                    : "bg-ink-950/5 text-ink-950 dark:bg-white/10 dark:text-white")}>
                        {n}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function ReadinessSheet({
    payload,
    onClose,
    onCheckIn,
    onSavePrefs,
    onDelete,
    busy = false,
}) {
    const consent = payload?.consent || {};
    const preference = payload?.preference || {};
    const [feel, setFeel] = useState(payload?.checkin?.feel || null);
    const [soreness, setSoreness] = useState(payload?.checkin?.soreness || null);
    const [optedIn, setOptedIn] = useState(!!consent.opted_in);
    const [agreed, setAgreed] = useState(!!consent.opted_in);
    const [scopes, setScopes] = useState(consent.scopes || []);
    const [zone, setZone] = useState(payload?.timezone || "");
    const [pushOn, setPushOn] = useState(!!preference.morning_push_enabled);
    const [pushAt, setPushAt] = useState(minuteToClock(preference.morning_push_minute ?? 7 * 60));
    const [quietStart, setQuietStart] = useState(minuteToClock(preference.quiet_start_minute ?? 22 * 60));
    const [quietEnd, setQuietEnd] = useState(minuteToClock(preference.quiet_end_minute ?? 7 * 60));
    const zones = useMemo(() => timezoneChoices(zone), [zone]);
    const available = consent.available_scopes || [];

    function toggleScope(id) {
        setScopes((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    }

    async function saveCheck() {
        if (!feel) return;
        await onCheckIn({feel, soreness});
    }

    async function savePrefs() {
        const body = {
            timezone: zone,
            morning_push_enabled: pushOn,
            morning_push_minute: clockToMinute(pushAt),
            quiet_start_minute: clockToMinute(quietStart) ?? 22 * 60,
            quiet_end_minute: clockToMinute(quietEnd) ?? 7 * 60,
            scopes,
        };
        if (optedIn && !consent.opted_in) {
            body.opted_in = true;
            body.consent = agreed;
        } else if (!optedIn && consent.opted_in) {
            body.opted_in = false;
        } else if (optedIn) {
            body.opted_in = true;
        }
        await onSavePrefs(body);
    }

    return (
        <OverlaySheet title="Readiness" onClose={onClose} zClass="z-[80]" labelledBy="readiness-sheet-title">
            <div className="space-y-5">
                <div className="flex items-center gap-3">
                    <ReadinessRing score={payload?.score} band={payload?.band} size={56}/>
                    <div className="min-w-0">
                        <p className="font-display text-lg text-ink-950 dark:text-white">
                            {BAND_LABEL[payload?.band] || "Warming up"}
                        </p>
                        <p className="text-xs text-muted">{payload?.why || "A few mornings of history and this fills in."}</p>
                    </div>
                </div>
                <p className="text-xs text-muted">{payload?.disclaimer || READINESS_DISCLAIMER}</p>
                <p className="text-xs text-muted">Only you see this. It never goes on the board.</p>

                <TrendChart trend={payload?.trend || []}/>

                <ChoiceRow label="How do you feel?" hint="1 is flat, 5 is ready." value={feel} max={5} onPick={setFeel}/>
                <ChoiceRow label="Soreness" hint="1 is fresh, 5 is sore. Optional." value={soreness} max={5} onPick={setSoreness}/>
                <button type="button" onClick={saveCheck} disabled={!feel || busy}
                        className="inline-flex min-h-[44px] items-center btn-plate px-4 text-sm font-bold disabled:opacity-50">
                    Save check-in
                </button>

                <section className="space-y-3">
                    <h3 className="font-display text-xs uppercase tracking-[0.16em]">Recovery data</h3>
                    <p className="text-xs leading-relaxed text-muted">{consent.text}</p>
                    <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
                        <input type="checkbox" checked={optedIn} onChange={(event) => setOptedIn(event.target.checked)}/>
                        Use daily recovery summaries
                    </label>
                    {optedIn && !consent.opted_in && (
                        <label className="flex min-h-[44px] items-center gap-3 text-sm">
                            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)}/>
                            I agree. Store only the daily numbers, and let me delete them.
                        </label>
                    )}
                    {available.length === 0 && (
                        <p className="text-xs text-muted">
                            Strava does not provide sleep or HRV. The check-in and your training load still set the order.
                        </p>
                    )}
                    {available.map((scope) => (
                        <label key={scope.id} className="flex min-h-[44px] items-center gap-3 text-sm">
                            <input type="checkbox" checked={scopes.includes(scope.id)}
                                   onChange={() => toggleScope(scope.id)} disabled={!optedIn}/>
                            {scope.label}
                        </label>
                    ))}
                    <label className="block text-sm font-semibold">
                        Time zone
                        <select value={zone} onChange={(event) => setZone(event.target.value)}
                                className="mt-1 block min-h-[44px] w-full rounded-xl bg-ink-950/5 px-3 text-sm dark:bg-white/10">
                            {zones.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </label>
                    <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
                        <input type="checkbox" checked={pushOn} onChange={(event) => setPushOn(event.target.checked)}/>
                        Morning push with the order
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        <label className="text-xs font-bold">
                            Push
                            <input type="time" value={pushAt} onChange={(event) => setPushAt(event.target.value)}
                                   className="mt-1 block min-h-[44px] w-full rounded-xl bg-ink-950/5 px-2 text-sm dark:bg-white/10"/>
                        </label>
                        <label className="text-xs font-bold">
                            Quiet from
                            <input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)}
                                   className="mt-1 block min-h-[44px] w-full rounded-xl bg-ink-950/5 px-2 text-sm dark:bg-white/10"/>
                        </label>
                        <label className="text-xs font-bold">
                            Quiet until
                            <input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)}
                                   className="mt-1 block min-h-[44px] w-full rounded-xl bg-ink-950/5 px-2 text-sm dark:bg-white/10"/>
                        </label>
                    </div>
                    <button type="button" onClick={savePrefs} disabled={busy || (optedIn && !consent.opted_in && !agreed)}
                            className="inline-flex min-h-[44px] items-center btn-plate px-4 text-sm font-bold disabled:opacity-50">
                        Save readiness
                    </button>
                    <button type="button" onClick={onDelete} disabled={busy}
                            className="block min-h-[44px] text-sm font-semibold text-red-600 dark:text-red-400">
                        Delete my recovery data
                    </button>
                </section>
            </div>
        </OverlaySheet>
    );
}

export function HomeReadiness({competitionId, pulse, rank, groupOrder, accent}) {
    const [open, setOpen] = useState(false);
    const {data} = useGetReadinessTodayQuery(
        competitionId ? {competition: competitionId} : undefined,
        {skip: false},
    );
    const [saveCheckIn, {isLoading: checking}] = useSaveCheckInMutation();
    const [savePrefs, {isLoading: saving}] = useSaveReadinessPreferencesMutation();
    const [wipe, {isLoading: wiping}] = useDeleteReadinessDataMutation();
    const order = orderForHome(groupOrder, data, competitionId);

    async function onCheckIn(body) {
        try {
            await saveCheckIn(body).unwrap();
            toast.success("Check-in saved.");
        } catch (err) {
            toast.error(errText(err, "Could not save the check-in."));
        }
    }

    async function onSavePrefs(body) {
        const recoveryScopes = ["sleep", "hrv", "resting_hr"];
        const askingDevice = body.opted_in && (body.scopes || []).some((scope) => recoveryScopes.includes(scope));
        try {
            await savePrefs(body).unwrap();
            if (askingDevice && isNativeHealthAvailable()) {
                await requestRecoveryAuthorization();
            }
            toast.success("Readiness saved.");
        } catch (err) {
            toast.error(errText(err, "Could not save readiness."));
        }
    }

    async function onDelete() {
        const ok = await confirmAction("Delete every stored recovery day, check-in and personal order?");
        if (!ok) return;
        try {
            await wipe().unwrap();
            setOpen(false);
            toast.success("Recovery data deleted.");
        } catch (err) {
            toast.error(errText(err, "Could not delete recovery data."));
        }
    }

    return (
        <>
            <HomePulse
                minutes={pulse?.weekMinutes}
                streak={pulse?.weekStreak}
                activeDays={pulse?.activeDays}
                rank={rank}
                readiness={data}
                onOpenReadiness={() => setOpen(true)}
            />
            <HomeOrderCard order={order} accent={accent}/>
            {open && data && (
                <ReadinessSheet
                    payload={data}
                    onClose={() => setOpen(false)}
                    onCheckIn={onCheckIn}
                    onSavePrefs={onSavePrefs}
                    onDelete={onDelete}
                    busy={checking || saving || wiping}
                />
            )}
        </>
    );
}

export function usePersonalOrder(competitionId) {
    const {data} = useGetReadinessTodayQuery(
        competitionId ? {competition: competitionId} : undefined,
        {skip: !competitionId},
    );
    if (!data?.order || String(data.order.competition_id) !== String(competitionId)) return null;
    return data.order;
}

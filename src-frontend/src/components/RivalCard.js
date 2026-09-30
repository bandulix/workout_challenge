import React from "react";
import {ChevronRight, Target} from "lucide-react";
import {Link} from "react-router-dom";
import {BoxSection} from "../utils/miscellaneous";

function goalAmount(value, goalKey) {
    const shown = Number.isInteger(value) ? String(value) : String(Number(value).toFixed(1)).replace(/\.0$/, "");
    if (goalKey === "active-days") return `${shown} active ${value === 1 ? "day" : "days"}`;
    if (goalKey === "workout-minutes") return `${shown} ${value === 1 ? "minute" : "minutes"}`;
    return `${shown} km`;
}

export default function RivalCard({model, onPin, onDismiss, isPinned = false, plate = false}) {
    if (!model) return null;

    let title;
    let detail;
    if (model.kind === "chasing") {
        title = `Close the gap to @${model.rivalUsername}`;
        const place = model.rivalPlacesAhead === 1 ? "place" : "places";
        if (model.goalCompleted) {
            detail = `${model.rivalPlacesAhead} ${place} ahead. You’ve met your weekly ${model.goalLabel} goal; any further activity is optional. Challenge credit depends on the configured goals and remaining caps; no session guarantees a rank change.`;
        } else if (model.goalKey && model.goalRemaining !== null && model.goalRemaining !== undefined) {
            const remaining = goalAmount(model.goalRemaining, model.goalKey);
            const nextStep = model.suggestedWorkout
                ? `If it fits your plan, ${model.suggestedWorkout} could contribute toward your weekly ${model.goalLabel} goal if there’s cap room.`
                : "A planned, comfortable activity can move you toward it.";
            detail = `${model.rivalPlacesAhead} ${place} ahead. ${remaining} left toward your weekly goal. ${nextStep} Challenge credit follows configured goals and remaining caps; no session guarantees a rank change.`;
        } else if (model.goalKey) {
            detail = `${model.rivalPlacesAhead} ${place} ahead. Your weekly ${model.goalLabel} target is set; recent progress is unavailable. Challenge credit follows configured goals and remaining caps; no session guarantees a rank change.`;
        } else {
            const nextStep = model.suggestedWorkout
                ? `If it fits your plan, ${model.suggestedWorkout} could add to your challenge score if there’s cap room.`
                : "Your next planned, comfortable activity could narrow the gap if it fits a scoring goal.";
            detail = `${model.rivalPlacesAhead} ${place} ahead. ${nextStep} No session guarantees a rank change.`;
        }
    } else if (model.kind === "defending") {
        title = `Hold your lead over @${model.rivalUsername}`;
        const places = model.rivalPlacesBehind === 1 ? "place" : "places";
        const nextStep = model.suggestedWorkout
            ? `If it fits your plan, ${model.suggestedWorkout} could add to your score if there’s cap room.`
            : "Keep to your own pace.";
        detail = `${model.rivalPlacesBehind} ${places} behind @${model.rivalUsername}. ${nextStep} Scoring follows configured goals and caps; no session guarantees a rank change.`;
    } else if (model.kind === "tied") {
        title = `You’re level with @${model.rivalUsername}`;
        const nextStep = model.suggestedWorkout
            ? `If it fits your plan, ${model.suggestedWorkout} could add to your score if there’s cap room.`
            : "Your next planned activity may change the standings.";
        detail = `You and @${model.rivalUsername} are tied. ${nextStep} Scoring follows configured goals and caps; no session guarantees a rank change.`;
    } else if (model.kind === "personal-goal") {
        title = "Your personal target";
        const target = goalAmount(model.goalTarget, model.goalKey);
        if (model.goalCurrent === null) {
            detail = `Aim for ${target} over the past 7 days, at your own pace.`;
        } else if (model.goalCompleted) {
            detail = `You’ve reached ${target} over the past 7 days. Keep it at your own pace.`;
        } else {
            const current = goalAmount(model.goalCurrent, model.goalKey);
            const remaining = goalAmount(model.goalRemaining, model.goalKey);
            const nextStep = model.suggestedWorkout
                ? ` If it fits your plan, ${model.suggestedWorkout} could contribute toward your weekly ${model.goalLabel} goal.`
                : "";
            detail = `${current} of ${target} over the past 7 days; ${remaining} to meet your target.${nextStep}`;
        }
    } else if (model.kind === "leading") {
        title = "You’re at the top of the board";
        detail = "Your next activity will add to the board.";
    } else if (model.kind === "no-rival") {
        title = "Keep building your challenge";
        detail = "There’s no clear rival to chase right now. Your next activity still adds to the board.";
    } else {
        title = "Put your name on the board";
        detail = "Your first synced or added workout will put you on the standings.";
    }

    if (model.gapChanged) {
        const changeLine = ["chasing", "defending", "tied"].includes(model.kind)
            ? "The standings against your rival just changed."
            : "Your challenge standings just changed.";
        detail = `${changeLine} ${detail}`;
    }

    const eyebrow = ["chasing", "defending", "tied"].includes(model.kind)
        ? (model.rivalIsPinned ? "Your pinned rival" : "Your next rival")
        : model.kind === "personal-goal"
            ? "Your own goal"
            : "Your challenge";

    const inner = (
        <>
            <div className="flex items-start gap-3">
                <Link
                    to={`/competition/${model.challengeId}`}
                    aria-label={`Open ${model.challengeName}: ${title}`}
                    className="group flex min-w-0 flex-1 items-start gap-3 rounded-xl text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-400 focus-visible:ring-offset-2"
                >
                    {!plate && (
                        <div className="mt-0.5 rounded-full bg-volt-400/15 p-2 text-volt-700 dark:text-volt-300">
                            <Target className="h-5 w-5" aria-hidden="true"/>
                        </div>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                            <p className={plate
                                ? "text-xs font-bold uppercase tracking-[0.16em] text-volt-300"
                                : "text-xs font-bold uppercase tracking-[0.16em] text-volt-700 dark:text-volt-300"}>
                                {eyebrow}
                            </p>
                            <span className={plate
                                ? "text-xs font-semibold text-white/50"
                                : "text-xs font-semibold text-gray-500 dark:text-gray-400"}>
                                {plate ? model.challengeName : `· ${model.challengeName}`}
                            </span>
                        </div>
                        <h2 className={"mt-0.5 font-extrabold " + (plate ? "text-lg text-white" : "text-base text-gray-900 dark:text-gray-100")}>{title}</h2>
                        <p className={"mt-1 text-sm " + (plate ? "text-white/70" : "text-gray-600 dark:text-gray-300")}>{detail}</p>
                    </div>
                    <ChevronRight
                        className={"mt-1 h-5 w-5 shrink-0 transition group-hover:translate-x-0.5 " + (plate
                            ? "text-white/40 group-hover:text-volt-300"
                            : "text-gray-400 group-hover:text-volt-600 dark:text-gray-500")}
                        aria-hidden="true"
                    />
                </Link>
                {onPin && model.rivalId && ["chasing", "defending", "tied"].includes(model.kind) && (
                    <button type="button" onClick={onPin}
                            aria-label={isPinned ? `Unpin @${model.rivalUsername}` : `Pin @${model.rivalUsername}`}
                            className={"min-h-[44px] min-w-[44px] rounded-full text-xs font-semibold " + (plate
                                ? "text-white/70 hover:text-volt-300"
                                : "text-gray-600 hover:text-volt-700 dark:text-gray-300 dark:hover:text-volt-300")}>
                        {isPinned ? "Pinned" : "Pin"}
                    </button>
                )}
            </div>
            {onDismiss && (
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={onDismiss}
                            className="min-h-[44px] rounded-full btn-glass px-4 py-2 text-sm font-semibold">
                        Dismiss until tomorrow
                    </button>
                </div>
            )}
        </>
    );

    if (plate) {
        return (
            <div className="rounded-3xl border border-white/10 bg-ink-950/80 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                {inner}
            </div>
        );
    }

    return (
        <BoxSection additionalClasses="mb-4 border-l-4 border-volt-400">
            {inner}
        </BoxSection>
    );
}

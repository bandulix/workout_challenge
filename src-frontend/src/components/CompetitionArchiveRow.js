import React from "react";
import {useNavigate} from "react-router-dom";
import {Chip, rowClass} from "./uiBits";
import {isChallengeEnded} from "../utils/challengeArchive";

export default function CompetitionArchiveRow({competition, archived = false, onArchive, onRestore, now = new Date()}) {
    const navigate = useNavigate();
    const completed = isChallengeEnded(competition?.end_date, now);
    const summary = competition?.my_rank_summary || null;
    const rank = summary?.my_rank;
    const started = summary?.started;

    return (
        <li className="flex items-stretch gap-2">
            <button
                type="button"
                aria-label={`Open challenge ${competition.name}`}
                onClick={() => navigate(`/competition/${competition.id}`)}
                className={`${rowClass} min-w-0 flex-1`}
            >
                <div className="min-w-0 flex-1 text-left">
                    <p className="font-semibold truncate">{competition.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{competition.start_date_fmt} – {competition.end_date_fmt}</p>
                </div>
                <div className="shrink-0 text-right">
                    {!summary ? (
                        <span className="text-gray-500 dark:text-gray-400 text-sm">—</span>
                    ) : !started ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400">Not started</span>
                    ) : rank == null ? (
                        <span className="text-xs font-semibold text-volt-600 dark:text-volt-300">Time to work out!</span>
                    ) : (
                        <>
                            <p className="font-display text-xl text-volt-600 dark:text-volt-400 leading-none">#{rank}</p>
                            {competition.has_teams && summary.team_rank != null && (
                                <Chip>Team #{summary.team_rank}</Chip>
                            )}
                        </>
                    )}
                </div>
            </button>
            {completed && (archived ? (
                <button type="button" onClick={() => onRestore?.(competition.id)}
                    className="min-h-[44px] self-center rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    aria-label={`Restore ${competition.name}`}>
                    Restore
                </button>
            ) : (
                <button type="button" onClick={() => onArchive?.(competition.id)}
                    className="min-h-[44px] self-center rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    aria-label={`Archive ${competition.name}`}>
                    Archive
                </button>
            ))}
        </li>
    );
}

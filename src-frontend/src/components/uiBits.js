import React from "react";
import {RefreshCw} from "lucide-react";
import PersonaAvatar from "./PersonaAvatar";

export const VOLT = "#d7ff3e";

export function SectionHead({title, hint, children}) {
    return (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-950/10 dark:border-volt-400/15 pb-3 mb-1">
            <div className="flex-1 min-w-0 px-1">
                <h2 className="text-sm font-semibold text-ink-950 dark:text-gray-200">{title}</h2>
                {hint && <p className="text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
            </div>
            {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
        </div>
    );
}

/** Feed-style section label: hairline rule, no wrapping box. */
export function PaneHead({title, hint, children}) {
    return (
        <div className="mb-3 px-1">
            <div className="flex items-center gap-3">
                <h2 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-gray-400 shrink-0">{title}</h2>
                <span className="flex-1 h-px bg-ink-950/10 dark:bg-white/10" aria-hidden="true"/>
                {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
            </div>
            {hint && <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{hint}</p>}
        </div>
    );
}

export const paneCardClass =
    "min-w-0 rounded-3xl glass-card p-3.5 sm:p-4 text-ink-950 dark:text-white";

export function Chip({children}) {
    return (
        <span className="shrink-0 rounded-full bg-volt-400/30 text-volt-800 dark:bg-volt-400/15 dark:text-volt-300 text-[11px] font-semibold px-2 py-0.5">
            {children}
        </span>
    );
}

export function EmptyState({title, body, actionLabel, onAction}) {
    return (
        <div className="flex flex-col items-center text-center py-8 px-4">
            <PersonaAvatar persona={{avatar: "megaphone", theme_color: "#d7ff3e"}} size={56} glow/>
            <p className="mt-3 font-semibold text-ink-950 dark:text-gray-100">{title}</p>
            {body && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-xs">{body}</p>}
            {onAction && actionLabel && (
                <button type="button" onClick={onAction}
                        className="mt-4 px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt">
                    {actionLabel}
                </button>
            )}
        </div>
    );
}

export function SyncChip({onClick, isLoading, short, long}) {
    return (
        <button type="button" onClick={onClick} disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full btn-glass text-ink-950 dark:text-gray-200 text-sm font-semibold min-h-[44px] transition disabled:opacity-50">
            <RefreshCw className={"h-3.5 w-3.5 " + (isLoading ? "animate-spin" : "")}/>
            <span className="sm:hidden">{isLoading ? "…" : short}</span>
            <span className="hidden sm:inline">{isLoading ? "Syncing…" : long}</span>
        </button>
    );
}

export const rowClass =
    "w-full flex items-center gap-3 py-3 px-2 rounded-2xl hover:bg-ink-950/[0.05] dark:hover:bg-white/[0.06] transition min-h-[44px] text-left";

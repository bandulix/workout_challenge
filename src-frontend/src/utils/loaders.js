import React from "react";
import {BeatLoader} from "react-spinners";
import {BoxSection} from "./miscellaneous";

function SectionLoader({height = "h-64", message = null}) {
    return (
        <BoxSection additionalClasses={"flex flex-col items-center justify-center " + height}>
            {(message !== null) && <><div className="text-gray-800 dark:text-gray-200 mb-3">{message}</div></>}
            <div><BeatLoader color="#d7ff3e" /></div>
        </BoxSection>
    )
}


// Content-shaped skeletons: the placeholder already has the geometry of
// the incoming content, so the page doesn't jump when data lands. The
// pulse is gated by prefers-reduced-motion (index.css .skeleton rule).
export function Skeleton({className = ""}) {
    return (
        <div aria-hidden="true"
             className={"skeleton animate-pulse rounded-xl bg-ink-950/8 dark:bg-white/8 " + className}/>
    );
}

// Leaderboard-shaped: rank number, avatar circle, two text bars, points.
export function SkeletonRows({n = 4}) {
    return (
        <div role="status" aria-label="Loading" className="space-y-3">
            {Array.from({length: n}, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-3xl glass-card p-3.5 sm:p-4">
                    <Skeleton className="h-5 w-6 shrink-0"/>
                    <Skeleton className="h-11 w-11 shrink-0 !rounded-full"/>
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-2/5"/>
                        <Skeleton className="h-2.5 w-1/4"/>
                    </div>
                    <Skeleton className="h-4 w-10 shrink-0"/>
                </div>
            ))}
        </div>
    );
}

// Gallery-shaped: a grid of image tiles with a caption bar.
export function SkeletonTiles({n = 6, cols = 3}) {
    return (
        <div role="status" aria-label="Loading"
             className={"grid gap-3 " + (cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
            {Array.from({length: n}, (_, i) => (
                <div key={i} className="rounded-3xl glass-card overflow-hidden">
                    <Skeleton className="h-36 w-full !rounded-none"/>
                    <div className="px-2.5 py-2"><Skeleton className="h-3 w-3/4"/></div>
                </div>
            ))}
        </div>
    );
}

// Card-shaped block for stat panels / dashboards.
export function SkeletonCard({height = "h-40"}) {
    return (
        <div role="status" aria-label="Loading"
             className={"rounded-3xl glass-card p-5 sm:p-6 " + height}>
            <Skeleton className="h-3 w-1/3 mb-4"/>
            <Skeleton className="h-10 w-1/2 mb-3"/>
            <Skeleton className="h-3 w-2/3"/>
        </div>
    );
}

export {SectionLoader};

import React, {useState} from "react";
import {
    Anchor, Building2, Check, CloudLightning, CloudRain, Compass, Droplets, Flag, HelpCircle, Info,
    Map as MapIcon, MapPin, Mountain, Orbit, Rocket, Sparkles, Sun, Target, Tent, Timer, Trophy,
    Users, Waves, Wind,
} from "lucide-react";
import {useGetExpeditionByCompetitionQuery, useVoteExpeditionShortcutMutation} from "../utils/reducers/competitionsSlice";
import {useProtectedImage} from "../utils/protectedMedia";
import ExpeditionPostcard from "./ExpeditionPostcard";

const LANDMARKS = {
    trailhead: {title: "Trailhead", assetKey: "trailhead-v1"},
    "river-crossing": {title: "River crossing", assetKey: "river-crossing-v1"},
    "high-pass": {title: "High pass", assetKey: "high-pass-v1"},
    finale: {title: "Summit", assetKey: "finale-v1"},
};

// Route themes: same engine, different skin. Icons per landmark slot, a
// deterministic backdrop silhouette (no runtime-generated art) and a sky.
// Landmark *names* come from the API (`landmark_titles`) so backend and map
// never disagree; these are the fallbacks for older payloads.
const THEMES = {
    summit: {
        icons: {trailhead: MapPin, "river-crossing": Waves, "high-pass": Mountain, finale: Flag},
        backdrop: "M0 190 L0 150 L60 118 L110 138 L170 96 L230 122 L290 70 L340 96 L392 34 L420 60 L420 190 Z",
        sky: "from-gray-100 to-gray-50 dark:from-ink-800 dark:to-ink-950",
        ground: "fill-gray-300 dark:fill-ink-700",
    },
    ocean: {
        icons: {trailhead: Anchor, "river-crossing": Waves, "high-pass": CloudLightning, finale: Flag},
        backdrop: "M0 190 L0 160 Q30 150 60 160 T120 160 T180 160 T240 160 T300 160 T360 160 T420 160 L420 190 Z",
        sky: "from-gray-100 to-gray-50 dark:from-ink-800 dark:to-ink-950",
        ground: "fill-cyan-300/40 dark:fill-cyan-900/40",
    },
    desert: {
        icons: {trailhead: Droplets, "river-crossing": Sun, "high-pass": Mountain, finale: Building2},
        backdrop: "M0 190 L0 160 Q70 120 140 158 Q200 190 260 150 Q320 112 420 156 L420 190 Z",
        sky: "from-gray-100 to-gray-50 dark:from-ink-800 dark:to-ink-950",
        ground: "fill-amber-300/40 dark:fill-amber-900/40",
    },
    space: {
        icons: {trailhead: Rocket, "river-crossing": Orbit, "high-pass": Sparkles, finale: Target},
        backdrop: "M0 190 L0 176 Q210 150 420 176 L420 190 Z",
        sky: "from-gray-100 to-gray-50 dark:from-ink-900 dark:to-ink-950",
        ground: "fill-indigo-300/40 dark:fill-indigo-900/40",
        stars: true,
    },
    relay: {
        icons: {trailhead: Flag, "river-crossing": Timer, "high-pass": Mountain, finale: Trophy},
        backdrop: "M0 190 L0 170 L420 170 L420 190 Z",
        sky: "from-gray-100 to-gray-50 dark:from-ink-800 dark:to-ink-950",
        ground: "fill-gray-300 dark:fill-ink-700",
        lanes: true,
    },
};

function themeOf(expedition) {
    return THEMES[expedition?.route_theme] || THEMES.summit;
}

function landmarkTitle(expedition, milestoneId) {
    const fromApi = expedition?.landmark_titles?.[milestoneId];
    if (fromApi) return fromApi;
    return LANDMARKS[milestoneId]?.title || String(milestoneId || "").replaceAll("-", " ");
}

function landmarkIcon(expedition, milestoneId) {
    return themeOf(expedition).icons[milestoneId] || MapIcon;
}

const OBJECTIVE_ICONS = {expedition: MapIcon, rescue: CloudRain, basecamp: Tent, treasure: Sparkles};
const TWIST_ICONS = {storm: CloudLightning, rest: Sun, rope: Users, shortcut: Compass};

const APPROVED_PERSONA_ASSETS = new Set([
    "butler", "captain", "cheerleader", "megaphone", "ninja",
    "robot", "roast", "rocket", "sergeant", "zen",
]);

// One colour per crew member, painted onto the trail behind the crew. No greens:
// green is reserved for "reached" landmarks.
const CREW_COLORS = ["#0ea5e9", "#f59e0b", "#a855f7", "#ec4899", "#6366f1", "#f97316", "#06b6d4", "#d946ef"];

function CoachPortrait({coach, className = ""}) {
    const key = coach?.avatar_asset_key;
    if (APPROVED_PERSONA_ASSETS.has(key)) {
        return <img
            alt=""
            aria-hidden="true"
            className={`h-5 w-5 shrink-0 object-contain ${className}`}
            src={`/personas/${key}.svg`}
        />;
    }
    return <Compass aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`}/>;
}

const STATUS_LABELS = {
    completed: "Reached",
    upcoming: "Ahead",
    "in-progress": "Now",
    behind: "Now",
    ready: "Ready",
};

function percent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    const safe = Math.max(0, Math.min(100, number));
    return Number.isInteger(safe) ? String(safe) : safe.toFixed(1).replace(/\.0$/, "");
}

function points(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return Math.round(number).toLocaleString();
}

function routeDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date pending";
    const date = new Date(`${value}T00:00:00Z`);
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    }).format(date);
}

function coachAccent(value) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#426b55";
}

function initials(name) {
    return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

// Crew pictures come from the JWT-only /api/user/<id>/picture/ endpoint.
// A bare <img>/<image href> can't send the token and 401s on every
// mount (a burst CrowdSec bans for), so the file is fetched with the
// header and rendered from a local URL - see utils/protectedMedia.
// Until that resolves (or when it fails) the initials stand in.
function useCrewFace(member) {
    const {src} = useProtectedImage(member?.profile_picture || null, "avatar");
    return src;
}

function CrewMarkerFace({member}) {
    const src = useCrewFace(member);
    if (!src) {
        return <text fontSize="9" fontWeight="700" textAnchor="middle" y="3.5" fill="#0f172a">{initials(member.name)}</text>;
    }
    return (
        <>
            <clipPath id={`crew-face-${member.id}`}><circle r="8"/></clipPath>
            <image clipPath={`url(#crew-face-${member.id})`} height="16" href={src}
                preserveAspectRatio="xMidYMid slice" width="16" x="-8" y="-8"/>
        </>
    );
}

function CrewRowFace({member, color}) {
    const src = useCrewFace(member);
    if (!src) {
        return (
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{backgroundColor: color}}>
                {initials(member.name)}
            </span>
        );
    }
    return <img alt="" aria-hidden="true" className="h-7 w-7 rounded-full object-cover" src={src}/>;
}

// Trail geometry: a fixed, non-geographic path with a light elevation feel.
const ROUTE_POSITIONS = [
    {milestoneId: "trailhead", progress: 0, x: 28, y: 150, labelX: 10, labelY: 174},
    {milestoneId: "river-crossing", progress: 25, x: 130, y: 100, labelX: 120, labelY: 84, anchor: "end"},
    {milestoneId: "high-pass", progress: 60, x: 265, y: 128, labelX: 238, labelY: 156},
    {milestoneId: "finale", progress: 100, x: 392, y: 36, labelX: 360, labelY: 22},
];

function routePosition(value) {
    const progress = Math.max(0, Math.min(100, Number(value) || 0));
    let segment = 0;
    while (segment < ROUTE_POSITIONS.length - 2 && progress > ROUTE_POSITIONS[segment + 1].progress) {
        segment += 1;
    }
    const start = ROUTE_POSITIONS[segment];
    const end = ROUTE_POSITIONS[segment + 1];
    const ratio = (progress - start.progress) / (end.progress - start.progress);
    return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
    };
}

// Crew members with a stable colour and the length of trail they painted.
function crewSegments(expedition, progress) {
    const crew = Array.isArray(expedition.contributors) ? expedition.contributors : [];
    if (!crew.length) return [];
    const total = crew.reduce((sum, member) => sum + Math.max(0, Number(member.points) || 0), 0);
    let offset = 0;
    return crew.map((member, index) => {
        const length = total > 0 ? (Math.max(0, Number(member.points) || 0) / total) * progress : 0;
        const segment = {member, color: CREW_COLORS[index % CREW_COLORS.length], start: offset, length};
        offset += length;
        return segment;
    });
}

function CrewMarker({crew, x, y}) {
    // The crew stands together on the trail: up to four faces, then "+n".
    const shown = crew.slice(0, 4);
    const overflow = crew.length - shown.length;
    const spread = 13;
    const startX = x - ((shown.length - 1) * spread) / 2;
    return (
        <g>
            <title>Crew position</title>
            <ellipse cx={x} cy={y + 12} rx={12 + shown.length * 4} ry="4" fill="rgba(15, 23, 42, 0.18)"/>
            {shown.map((member, index) => (
                <g key={member.id} transform={`translate(${startX + index * spread} ${y - 6})`}>
                    <circle r="10" fill="white" stroke={member.color} strokeWidth={member.is_you ? 3 : 2}/>
                    <CrewMarkerFace member={member}/>
                </g>
            ))}
            {overflow > 0 && (
                <text fontSize="9" fontWeight="700" x={startX + shown.length * spread - 2} y={y - 2}
                    className="fill-gray-800 dark:fill-gray-100">+{overflow}</text>
            )}
        </g>
    );
}

function ExpeditionRouteMap({expedition, progress}) {
    const theme = themeOf(expedition);
    const crewPosition = routePosition(progress);
    const pace = Number(expedition.pace_percent);
    const pacePosition = Number.isFinite(pace) && pace > 0 && pace < 100 ? routePosition(pace) : null;
    const storm = Number(expedition.storm_percent);
    const stormPosition = expedition.objective === "rescue" && Number.isFinite(storm) && storm > 0 ? routePosition(storm) : null;
    const byId = new Map(expedition.milestones.map((milestone) => [milestone.milestone_id, milestone]));
    const routePath = ROUTE_POSITIONS.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const segments = crewSegments(expedition, Number(progress));
    const crew = segments.map((segment) => ({...segment.member, color: segment.color}));
    const nextId = expedition.next_milestone?.milestone_id;
    const camp = expedition.objective === "basecamp" ? expedition.camp : null;
    const tents = camp ? Array.from({length: Math.max(0, Number(camp.tents) || 0)}, (_, index) =>
        routePosition(((index + 1) / Math.max(1, Number(camp.weeks_total) || 1)) * 100)) : [];

    return (
        <figure className="mt-3">
            <svg
                aria-label={`Shared route map, current position ${percent(progress)}%`}
                className={`h-auto w-full rounded-xl bg-gradient-to-b ${theme.sky}`}
                role="img"
                viewBox="0 0 420 190"
            >
                {theme.stars && [[30, 20], [90, 50], [150, 18], [210, 60], [300, 24], [360, 70], [400, 14], [250, 40]].map(([sx, sy]) => (
                    <circle cx={sx} cy={sy} fill="currentColor" key={`${sx}-${sy}`} r="1.3" className="text-gray-400 dark:text-gray-300"/>
                ))}
                <path d={theme.backdrop} className={theme.ground} opacity="0.8"/>
                {theme.lanes && [176, 182].map((ly) => (
                    <line key={ly} stroke="white" strokeDasharray="8 6" strokeWidth="1.5" x1="0" x2="420" y1={ly} y2={ly} opacity="0.7"/>
                ))}
                <path d={routePath} fill="none" pathLength="100" stroke="currentColor" strokeLinecap="round"
                    strokeDasharray="2 3" strokeWidth="4" className="text-gray-400 dark:text-gray-500"/>
                {segments.length === 0 && (
                    <path d={routePath} fill="none" pathLength="100" stroke="#15803d" strokeLinecap="round"
                        strokeDasharray={`${progress} 100`} strokeWidth="6"/>
                )}
                {segments.map((segment) => (
                    <path d={routePath} fill="none" key={segment.member.id} pathLength="100" stroke={segment.color}
                        strokeDasharray={`${segment.length} 100`} strokeDashoffset={-segment.start} strokeWidth="6">
                        <title>{`${segment.member.name}: ${points(segment.member.points)} pts`}</title>
                    </path>
                ))}
                {stormPosition && (
                    // Rescue run: the weather front creeping up the trail behind the crew.
                    <g className="text-gray-500 dark:text-gray-300">
                        <title>{`Storm front at ${percent(storm)}%`}</title>
                        <path d={routePath} fill="none" pathLength="100" stroke="rgba(71, 85, 105, 0.35)"
                            strokeDasharray={`${storm} 100`} strokeLinecap="round" strokeWidth="10"/>
                        <CloudRain color="currentColor" size={18} x={stormPosition.x - 9} y={stormPosition.y - 30}/>
                        <Wind color="currentColor" size={12} x={stormPosition.x - 24} y={stormPosition.y - 22}/>
                    </g>
                )}
                {tents.map((tent, index) => (
                    <g key={`tent-${index}`}>
                        <title>{`Tent ${index + 1} standing`}</title>
                        <Tent color="#b45309" size={14} x={tent.x - 7} y={tent.y - 24}/>
                    </g>
                ))}
                {pacePosition && (
                    <g className="text-gray-500 dark:text-gray-300">
                        <title>Today's pace marker</title>
                        <line stroke="currentColor" strokeDasharray="2 2" strokeWidth="1.5"
                            x1={pacePosition.x} x2={pacePosition.x} y1={pacePosition.y - 26} y2={pacePosition.y + 8}/>
                        <path d={`M ${pacePosition.x} ${pacePosition.y - 26} l 14 5 l -14 5 z`} fill="currentColor"/>
                        <text fill="currentColor" fontSize="8" x={pacePosition.x + 16} y={pacePosition.y - 17}>today</text>
                    </g>
                )}
                {ROUTE_POSITIONS.map((point) => {
                    const milestone = byId.get(point.milestoneId) || {};
                    const status = milestone.status;
                    const reached = status === "completed";
                    const hidden = Boolean(milestone.hidden);
                    const unstamped = reached && milestone.stamped === false;
                    const isNext = point.milestoneId === nextId;
                    const Icon = hidden ? HelpCircle : landmarkIcon(expedition, point.milestoneId);
                    const title = hidden ? "?" : landmarkTitle(expedition, point.milestoneId);
                    const fill = reached ? (unstamped ? "#94a3b8" : "#15803d") : "white";
                    const stroke = reached ? (unstamped ? "#64748b" : "#15803d") : isNext ? "#2563eb" : "#64748b";
                    return (
                        <g key={point.milestoneId}>
                            <circle cx={point.x} cy={point.y} r={isNext ? 11 : 9} fill={fill} stroke={stroke}
                                strokeDasharray={hidden ? "3 2" : undefined} strokeWidth={isNext ? 3 : 2}/>
                            {reached
                                ? <Check color="white" size={11} x={point.x - 5.5} y={point.y - 5.5}/>
                                : <Icon color={isNext ? "#2563eb" : "#475569"} size={11} x={point.x - 5.5} y={point.y - 5.5}/>}
                            {!hidden && (
                                <text x={point.labelX} y={point.labelY} fontSize="10" fontWeight={isNext ? 700 : 500}
                                    textAnchor={point.anchor || "start"}
                                    className="fill-gray-800 dark:fill-gray-100">
                                    {title}
                                </text>
                            )}
                            <title>{`${title}: ${unstamped ? "reached late — the storm took the stamp" : STATUS_LABELS[status] || "Ahead"}`}</title>
                        </g>
                    );
                })}
                {crew.length > 0
                    ? <CrewMarker crew={crew} x={crewPosition.x} y={crewPosition.y}/>
                    : <circle cx={crewPosition.x} cy={crewPosition.y} r="7" fill="white" stroke="#2563eb" strokeWidth="3">
                        <title>{`Current group position: ${percent(progress)}%`}</title>
                    </circle>}
            </svg>
            <figcaption className="sr-only">
                A fixed, non-geographic route. The trail behind the crew is coloured by each member's share of the points.
            </figcaption>
        </figure>
    );
}

function EnergyRing({member, color, cap}) {
    // Weekly stamina: fills to the weekly ceiling, gets a check when charged.
    const energy = Math.max(0, Math.min(100, Number(member.week_energy_percent) || 0));
    const radius = 17;
    const circumference = 2 * Math.PI * radius;
    const charged = energy >= 100;
    return (
        <span className="relative inline-flex h-11 w-11 items-center justify-center"
            title={`${member.name}: ${points(member.week_points)} of ${points(cap)} this week`}>
            <svg aria-label={`${member.name}: weekly energy ${percent(energy)}%`} className="absolute inset-0" role="img" viewBox="0 0 44 44">
                <circle cx="22" cy="22" fill="none" r={radius} stroke="currentColor" strokeWidth="3" className="text-gray-200 dark:text-ink-700"/>
                <circle cx="22" cy="22" fill="none" r={radius} stroke={color} strokeLinecap="round" strokeWidth="3"
                    strokeDasharray={`${(energy / 100) * circumference} ${circumference}`} transform="rotate(-90 22 22)"/>
            </svg>
            <CrewRowFace member={member} color={color}/>
            {charged && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 rounded-full bg-volt-400 p-0.5 text-ink-950"><Check size={8}/></span>}
        </span>
    );
}

function CrewRow({expedition}) {
    const segments = crewSegments(expedition, 100);
    if (segments.length === 0) return null;
    const cap = expedition.this_week?.cap_per_person || expedition.weekly_cap_per_person || 100;
    return (
        <ul aria-label="Crew" className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
            {segments.map(({member, color}) => (
                <li className="flex flex-col items-center gap-0.5 text-center" key={member.id}>
                    <EnergyRing member={member} color={color} cap={cap}/>
                    <span className="max-w-[4.5rem] truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                        {member.is_you ? "You" : member.name}
                    </span>
                    <span className="text-xs text-muted">{points(member.points)} pts</span>
                </li>
            ))}
        </ul>
    );
}

function statusLine(expedition) {
    const progress = Number(expedition.progress_percent) || 0;
    const pace = Number(expedition.pace_percent);
    const next = expedition.next_milestone;
    const week = expedition.this_week;
    const weekMaxed = week && Number(week.possible_points) > 0 && Number(week.earned_points) >= Number(week.possible_points);
    let tone = "text-gray-700 dark:text-gray-200";
    let headline;
    if (expedition.objective === "basecamp" && expedition.camp) {
        const camp = expedition.camp;
        const tents = Number(camp.tents) || 0;
        if (camp.this_week?.held) {
            headline = `Camp held · ${tents} tent${tents === 1 ? "" : "s"} standing`;
            tone = "text-volt-700 dark:text-volt-300";
        } else if (camp.this_week) {
            headline = `${points(Math.max(0, Number(camp.this_week.needed_points) - Number(camp.this_week.earned_points)))} pts to hold camp this week`;
            tone = "text-warning-text";
        } else {
            headline = `${tents} tent${tents === 1 ? "" : "s"} standing`;
        }
        return {headline, detail: `${tents} of ${camp.weeks_total} weeks`, tone};
    }
    const storm = Number(expedition.storm_percent);
    if (expedition.objective === "rescue" && Number.isFinite(storm)) {
        if (progress < storm - 0.5) {
            headline = "Storm caught the crew";
            tone = "text-warning-text";
        } else {
            headline = `Storm ${percent(progress - storm)}% behind the crew`;
            tone = progress - storm >= 5 ? "text-volt-700 dark:text-volt-300" : "text-warning-text";
        }
    } else if (Number.isFinite(pace) && progress >= pace - 0.5) {
        headline = weekMaxed ? "Crew fully charged this week" : "Crew on pace";
        tone = "text-volt-700 dark:text-volt-300";
    } else if (Number.isFinite(pace)) {
        headline = `Crew ${percent(pace - progress)}% behind today's flag`;
        tone = "text-warning-text";
    } else {
        headline = `Crew at ${percent(progress)}%`;
    }
    let detail = "";
    if (next) {
        const hidden = expedition.objective === "treasure";
        const title = hidden ? "the next find" : landmarkTitle(expedition, next.milestone_id);
        const toGo = Number(next.points_to_go) || 0;
        if (next.milestone_id === "finale") detail = `${hidden ? "Last chest opens" : `${title} on`} ${routeDate(next.target_on)}`;
        else if (hidden) detail = toGo > 0 ? "Something ahead on the trail" : `Next find opens ${routeDate(next.opens_on)}`;
        else if (toGo > 0) detail = `${points(toGo)} pts to ${title}`;
        else detail = `${title} opens ${routeDate(next.opens_on)}`;
    }
    return {headline, detail, tone};
}

function HowItWorks({expedition, open}) {
    if (!open) return null;
    const lines = Array.isArray(expedition.objective_help) && expedition.objective_help.length
        ? expedition.objective_help
        : [
            "Your workouts earn the usual points — and push the crew's marker along the trail.",
            `The ring is your weekly energy: ${points(expedition.weekly_cap_per_person || 100)} points fill it. Everyone counts the same.`,
            "The flag shows where a fully charged crew would be today. Landmarks unlock week by week; the finale is the last day.",
        ];
    const plan = expedition.twists?.plan || [];
    return (
        <ul className="mt-2 list-disc space-y-1 rounded-2xl bg-ink-950/5 p-3 pl-7 text-xs text-gray-700 dark:bg-white/5 dark:text-gray-200" id="expedition-help">
            {lines.map((line) => <li key={line}>{line}</li>)}
            {expedition.route_title && <li>This season's route: {expedition.route_title}. The next challenge gets a different one.</li>}
            {expedition.twists?.active?.help && <li>{expedition.twists.active.title}: {expedition.twists.active.help}</li>}
            {plan.length > 0 && !expedition.twists?.active && (
                <li>Some weeks bend the rules ({plan.map((item) => item.title).join(", ")}). The coach announces each one when it starts.</li>
            )}
        </ul>
    );
}

// The week's twist, spoken by the coach. During the shortcut week the crew
// votes right here.
function TwistChip({expedition, competitionId}) {
    const twist = expedition.twists?.active;
    const shortcut = expedition.twists?.shortcut;
    const [vote, {isLoading}] = useVoteExpeditionShortcutMutation();
    if (!twist) return null;
    const Icon = TWIST_ICONS[twist.kind] || Compass;
    const voting = twist.kind === "shortcut" && shortcut?.open;
    const decided = twist.kind === "shortcut" && shortcut?.result;
    const cast = (choice) => {
        if (!competitionId || isLoading) return;
        vote({id: competitionId, choice});
    };
    return (
        <aside aria-label={twist.title} className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-ink-950/10 bg-ink-950/5 p-2 text-sm text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-gray-100" role="status">
            <CoachPortrait coach={expedition.current_coach} className="h-7 w-7 rounded-full"/>
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-warning-text"/>
            <span className="min-w-0 flex-1">
                <span className="font-semibold">{twist.title}.</span>{" "}
                <span className="text-gray-700 dark:text-gray-200">
                    {decided ? `The crew chose the ${shortcut.result}.` : twist.coach_line}
                </span>
            </span>
            {voting && (
                <span className="flex items-center gap-1" data-no-swipe>
                    {["ridge", "valley"].map((choice) => {
                        const mine = shortcut.your_vote === choice;
                        const count = Number(choice === "ridge" ? shortcut.ridge_votes : shortcut.valley_votes) || 0;
                        return (
                            <button aria-pressed={mine} disabled={isLoading} key={choice} onClick={() => cast(choice)} type="button"
                                className={"rounded-full border px-2.5 py-1 text-xs font-semibold capitalize " + (mine
                                    ? "border-volt-400 bg-volt-400 text-ink-950"
                                    : "btn-glass border-transparent")}>
                                {choice}{count > 0 ? ` · ${count}` : ""}
                            </button>
                        );
                    })}
                </span>
            )}
        </aside>
    );
}

// One-line teaser for the top of the feed: the crew on a straight mini trail,
// the status word, and a tap that opens the full Trail page.
export function ExpeditionTeaser({expedition, onOpen}) {
    if (!expedition?.enabled || !Array.isArray(expedition.milestones)) return null;
    const progress = Math.max(0, Math.min(100, Number(expedition.progress_percent) || 0));
    const status = statusLine(expedition);
    const segments = crewSegments(expedition, progress);
    const crew = segments.map((segment) => ({...segment.member, color: segment.color}));
    const pace = Number(expedition.pace_percent);
    const statuses = new Map(expedition.milestones.map((milestone) => [milestone.milestone_id, milestone.status]));
    const x = (value) => 14 + (Math.max(0, Math.min(100, Number(value) || 0)) / 100) * 292;

    return (
        <button
            aria-label={`Open the Expedition trail: ${status.headline}, ${percent(progress)}% of the route`}
            className="mb-4 flex w-full items-center gap-3 rounded-3xl glass-card px-3 py-2.5 text-left text-ink-950 transition hover:bg-volt-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-400 dark:text-white"
            data-no-swipe
            onClick={onOpen}
            type="button"
        >
            <svg aria-hidden="true" className="h-11 min-w-0 flex-1" preserveAspectRatio="xMidYMid meet" viewBox="0 0 320 44">
                <line stroke="currentColor" strokeDasharray="2 3" strokeLinecap="round" strokeWidth="4"
                    className="text-gray-300 dark:text-ink-600" x1={x(0)} x2={x(100)} y1="26" y2="26"/>
                {segments.length === 0 && progress > 0 && (
                    <line stroke="#15803d" strokeLinecap="round" strokeWidth="6" x1={x(0)} x2={x(progress)} y1="26" y2="26"/>
                )}
                {segments.map((segment) => (
                    <line key={segment.member.id} stroke={segment.color} strokeWidth="6"
                        x1={x(segment.start)} x2={x(segment.start + segment.length)} y1="26" y2="26"/>
                ))}
                {Number.isFinite(pace) && pace > 0 && pace < 100 && (
                    <g className="text-gray-500 dark:text-gray-300">
                        <line stroke="currentColor" strokeDasharray="2 2" strokeWidth="1.5" x1={x(pace)} x2={x(pace)} y1="6" y2="32"/>
                        <path d={`M ${x(pace)} 6 l 9 3.5 l -9 3.5 z`} fill="currentColor"/>
                    </g>
                )}
                {ROUTE_POSITIONS.map((point) => {
                    const reached = statuses.get(point.milestoneId) === "completed";
                    return (
                        <circle cx={x(point.progress)} cy="26" fill={reached ? "#15803d" : "white"} key={point.milestoneId}
                            r="4.5" stroke={reached ? "#15803d" : "#64748b"} strokeWidth="2"/>
                    );
                })}
                {crew.length > 0
                    ? <CrewMarker crew={crew} x={x(progress)} y={26}/>
                    : <circle cx={x(progress)} cy="26" fill="white" r="6" stroke="#2563eb" strokeWidth="3"/>}
            </svg>
            <span className="shrink-0 text-right">
                <span className={`block text-sm font-semibold leading-tight ${status.tone}`}>{status.headline}</span>
                <span className="block text-xs text-muted">
                    {percent(progress)}% · Trail <span aria-hidden="true">›</span>
                </span>
            </span>
        </button>
    );
}

export function ExpeditionTimeline({expedition, canRematch = false, onRematch}) {
    const [helpOpen, setHelpOpen] = useState(false);
    if (!expedition?.enabled || !Array.isArray(expedition.milestones)) return null;

    const groupProgress = percent(expedition.progress_percent);
    const accent = coachAccent(expedition.current_coach?.theme_color);
    const status = statusLine(expedition);
    const ObjectiveIcon = OBJECTIVE_ICONS[expedition.objective] || MapIcon;
    // Treasure hunt: the latest find unlocks a chapter - the only prose on the map.
    const latestStory = expedition.objective === "treasure"
        ? [...expedition.milestones].reverse().find((milestone) => milestone.status === "completed" && milestone.story)?.story
        : null;

    return (
        <section
            aria-labelledby="expedition-title"
            className="mb-4 rounded-3xl glass-card p-4 text-ink-950 dark:text-white sm:p-5"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-white dark:bg-ink-900"
                        style={{borderColor: accent, color: accent}}>
                        <ObjectiveIcon size={20}/>
                    </span>
                    <div className="min-w-0">
                        <h2 id="expedition-title" className="font-display text-sm uppercase tracking-wider">
                            {expedition.objective_title || "Expedition"}
                        </h2>
                        <p className="text-xs text-muted">
                            {expedition.route_title ? `${expedition.route_title} · ` : ""}{expedition.participant_count || 0} on the trail
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button aria-controls="expedition-help" aria-expanded={helpOpen} aria-label="How the Expedition works"
                        className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition hover:bg-ink-950/5 hover:text-volt-700 dark:hover:bg-white/10 dark:hover:text-volt-300"
                        onClick={() => setHelpOpen((value) => !value)} type="button">
                        <Info size={18}/>
                    </button>
                </div>
            </div>
            <HowItWorks expedition={expedition} open={helpOpen}/>
            {expedition.twists?.active && <TwistChip competitionId={expedition.competition_id} expedition={expedition}/>}

            {expedition.coach_handover && (() => {
                const handover = expedition.coach_handover;
                const milestoneTitle = handover.milestone_id
                    ? landmarkTitle(expedition, handover.milestone_id)
                    : "the next landmark";
                return (
                    <aside
                        aria-label="Coach handover"
                        className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-ink-950/5 p-2 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-200"
                        role="status"
                    >
                        <CoachPortrait coach={handover.from}/>
                        <span>{handover.from?.name || "Trail Guide"} hands off to {handover.to?.name || "Trail Guide"} at {milestoneTitle}.</span>
                        <CoachPortrait coach={handover.to}/>
                    </aside>
                );
            })()}

            <ExpeditionRouteMap expedition={expedition} progress={groupProgress}/>

            <div aria-label="Shared Expedition progress" aria-valuemax={100} aria-valuemin={0}
                aria-valuenow={Number(groupProgress)} aria-valuetext={`${groupProgress}% of the shared route`}
                className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" role="progressbar">
                <span className={`text-sm font-semibold ${status.tone}`} role="status">{status.headline}</span>
                <span className="text-sm text-muted">
                    <span className="font-semibold text-gray-900 dark:text-white">{groupProgress}%</span>
                    {status.detail ? ` · ${status.detail}` : ""}
                </span>
            </div>

            <CrewRow expedition={expedition}/>

            <ol aria-label="Expedition milestones" className="mt-4 grid grid-cols-4 gap-1 text-center">
                {expedition.milestones.map((milestone) => {
                    const hidden = Boolean(milestone.hidden);
                    const title = hidden ? "?" : landmarkTitle(expedition, milestone.milestone_id);
                    const completed = milestone.status === "completed";
                    const unstamped = completed && milestone.stamped === false;
                    const active = !completed && milestone.status !== "upcoming";
                    const coach = milestone.coach_snapshot;
                    const coachStamp = completed && !unstamped && APPROVED_PERSONA_ASSETS.has(coach?.avatar_asset_key);
                    const Icon = hidden ? HelpCircle : landmarkIcon(expedition, milestone.milestone_id);
                    const label = unstamped
                        ? `${title}: reached late — the storm took the stamp`
                        : `${title}: ${STATUS_LABELS[milestone.status] || "Ahead"}` + (completed && coach?.name ? ` with ${coach.name}` : "");
                    return (
                        <li className="flex min-w-0 flex-col items-center gap-0.5" key={milestone.milestone_id}
                            title={label}>
                            {coachStamp ? (
                                // The coach who saw the crew through stamps the reached landmark.
                                <span className="block h-7 w-7 overflow-hidden rounded-full border-2 border-volt-400 bg-white dark:bg-ink-900">
                                    <img alt={`Completed with ${coach.name}`} className="h-full w-full object-cover"
                                        src={`/personas/${coach.avatar_asset_key}.svg`}/>
                                </span>
                            ) : (
                                <span aria-hidden="true"
                                    className={"flex h-7 w-7 items-center justify-center rounded-full border-2 " + (completed
                                        ? (unstamped
                                            ? "border-dashed border-gray-400 bg-gray-300 text-white dark:border-ink-600 dark:bg-ink-600"
                                            : "border-volt-400 bg-volt-400 text-ink-950")
                                        : active
                                            ? "border-volt-400 text-volt-700 shadow-glow-volt dark:text-volt-300"
                                            : "border-gray-300 text-gray-400 dark:border-ink-600 dark:text-gray-500")
                                        + (hidden ? " border-dashed" : "")}>
                                    {completed ? <Check size={14}/> : <Icon aria-hidden="true" className="h-4 w-4 shrink-0"/>}
                                </span>
                            )}
                            <span className="w-full truncate text-xs font-medium text-gray-900 dark:text-gray-100">{title}</span>
                            <span className="text-xs text-muted">
                                {completed ? (unstamped ? "Late" : STATUS_LABELS.completed) : hidden ? "Hidden" : routeDate(milestone.target_on)}
                            </span>
                        </li>
                    );
                })}
            </ol>
            {latestStory && (
                <p className="mt-2 text-center text-xs italic text-muted" role="note">“{latestStory}”</p>
            )}
            <ExpeditionPostcard
                title={expedition.title}
                finale={expedition.finale}
                canRematch={canRematch}
                onRematch={onRematch}
            />
        </section>
    );
}

export default function ExpeditionPanel({competitionId, canRematch = false, onRematch}) {
    const {data, error, isLoading} = useGetExpeditionByCompetitionQuery(competitionId, {
        skip: !competitionId,
    });

    if (data?.enabled) return (
        <ExpeditionTimeline expedition={data} canRematch={canRematch} onRematch={onRematch}/>
    );
    if (!error || error.status === 404 || isLoading) return null;
    return (
        <p className="mb-4 rounded-3xl glass-card p-4 text-sm text-muted" role="status">
            The Expedition route is temporarily unavailable.
        </p>
    );
}

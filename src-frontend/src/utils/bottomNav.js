import React, {useEffect, useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {Flag, Home, Plus, User2, Settings, Scale, BadgeHelp, Shield, LogOut, ChevronRight, Bot} from "lucide-react";
import WorkoutForm from "../forms/workoutForm";
import CompetitionForm from "../forms/competitionForm";
import {Modal} from "../forms/basicComponents";
import SettingsForm from "../forms/settingsForm";
import GoalEqualizerForm from "../forms/equalizerForm";
import SupportModal from "../forms/supportModal";
import {LinkStravaScreen} from "../pages/HowTo";
import RoasterModal from "../components/RoasterBox";
import PersonaAvatar from "../components/PersonaAvatar";
import ProfileAvatar from "../components/ProfileAvatar";
import {DogTagRow} from "../components/gameBits";
import {isNativeHealthAvailable, nativeHealthSetSource} from "./nativeHealth";
import {startNativeCoachPings} from "./nativeCoachPings";
import {useGetUserByIdQuery} from "./reducers/usersSlice";
import {useGetCompetitionsQuery} from "./reducers/competitionsSlice";
import {useGetDrillConfigsQuery} from "./reducers/drillInstructorSlice";
import {ensureFreshAccessToken} from "./authTokens";
import {primaryChallenge} from "./challenge";
import {isPublicPath} from "./publicPath";
import {onAppResume} from "./appLifecycle";


const COACH_FALLBACK = {name: "Coach", avatar: "megaphone", theme_color: "#d7ff3e"};

function coachAccent(persona) {
    const raw = String(persona?.theme_color || COACH_FALLBACK.theme_color).trim();
    if (/^#[0-9a-fA-F]{6}$/i.test(raw)) return raw;
    if (/^#[0-9a-fA-F]{3}$/i.test(raw)) {
        return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
    }
    return COACH_FALLBACK.theme_color;
}

function coachAccentRgba(persona, alpha) {
    const hex = coachAccent(persona).slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function NavLink({to, icon: Icon, label, isActive, onClick}) {
    const className =
        "relative flex flex-col items-center justify-center gap-1 py-2 px-2.5 min-w-[56px] min-h-[58px] transition-colors duration-200 " +
        (isActive ? "text-ink-950 dark:text-volt-200" : "text-ink-800 dark:text-gray-400 hover:text-ink-950 dark:hover:text-volt-200");
    const inner = (
        <>
            <Icon className={"relative z-10 h-5 w-5 transition-transform duration-300 " + (isActive ? "scale-110" : "")}
                  strokeWidth={isActive ? 2.4 : 1.8}
                  fill={isActive ? "currentColor" : "none"}/>
            <span className="relative z-10 flex flex-col items-center">
                <span className={"text-[10px] font-bold uppercase tracking-wider leading-none " +
                    (isActive ? "text-ink-950 dark:text-volt-200" : "")}>{label}</span>
                <span aria-hidden="true"
                      className={"nav-active-bar transition-all duration-300 " +
                          (isActive ? "opacity-100 scale-100" : "opacity-0 scale-50")}/>
            </span>
        </>
    );
    if (!to || to === "#") {
        return (
            <button onClick={onClick} className={className} aria-label={label} aria-current={isActive ? "page" : undefined}>
                {inner}
            </button>
        );
    }
    return (
        <Link to={to} onClick={onClick} className={className} aria-label={label} aria-current={isActive ? "page" : undefined}>
            {inner}
        </Link>
    );
}

function DockPanel({title, children}) {
    return (
        <div className="relative px-3 pt-3 pb-1 animate-dock-expand max-h-[min(58vh,32rem)] overflow-y-auto overscroll-contain">
            <h3 className="font-display text-[11px] uppercase tracking-[0.18em] px-1 mb-2 text-ink-800 dark:text-gray-400">{title}</h3>
            {children}
        </div>
    );
}

function CompetitionPickerPanel({onClose, onCreate}) {
    const {data: competitions, isSuccess} = useGetCompetitionsQuery();
    const navigate = useNavigate();

    return (
        <DockPanel title="Your challenges">
            <div className="space-y-0.5">
                {(competitions || []).map((c) => (
                    <button key={c.id}
                            onClick={() => {onClose(); navigate(`/competition/${c.id}`);}}
                            className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-2xl hover:bg-ink-950/8 dark:hover:bg-white/10 min-h-[48px]">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-volt-400/25 text-volt-800 dark:text-volt-300">
                            <Flag className="h-4 w-4"/>
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block font-semibold truncate">{c.name}</span>
                            <span className="block text-[11px] text-gray-500 dark:text-gray-400">{c.start_date_fmt} – {c.end_date_fmt}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-gray-400 shrink-0"/>
                    </button>
                ))}
                {isSuccess && competitions?.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 px-3 py-3">No challenges yet. Start one below.</p>
                )}
            </div>
            <button
                onClick={() => {onClose(); onCreate();}}
                className="w-full mt-2 mb-1 px-3 py-3 rounded-2xl bg-volt-400 text-ink-950 font-bold uppercase tracking-wide text-sm min-h-[44px] shadow-glow-volt">
                + Create a challenge
            </button>
        </DockPanel>
    );
}

function SettingsSheetRow({icon: Icon, label, onClick, danger = false, trailing = undefined}) {
    return (
        <button onClick={onClick}
                className={"w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-ink-950/8 dark:hover:bg-white/10 min-h-[48px] text-left " + (danger ? "text-red-500 dark:text-red-400" : "")}>
            <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
                (danger ? "bg-red-500/10" : "bg-ink-950/6 dark:bg-white/8")}>
                <Icon className="h-4 w-4"/>
            </span>
            <span className="flex-1 font-semibold text-sm">{label}</span>
            {trailing === null ? null : (trailing || <ChevronRight className="h-4 w-4 text-gray-400"/>)}
        </button>
    );
}

function SettingsPanel({onClose, user, isStaff, onAccount, onEqualizer, onRoaster, onSupport}) {
    const navigate = useNavigate();

    return (
        <DockPanel title="Settings">
            <div className="flex items-center gap-3 px-2 py-2 mb-1 rounded-2xl bg-ink-950/5 dark:bg-white/5">
                <ProfileAvatar user={user} size={48} editable/>
                <div className="min-w-0">
                    <p className="font-bold truncate">{user?.first_name} {user?.last_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
                    <DogTagRow tags={user?.dog_tags}/>
                </div>
            </div>
            <div className="space-y-0.5">
                <SettingsSheetRow icon={User2} label="Account" onClick={() => {onClose(); onAccount();}}/>
                <SettingsSheetRow icon={Scale} label="Goal Equalizer" onClick={() => {onClose(); onEqualizer();}}/>
                <SettingsSheetRow icon={Bot} label="The roaster" onClick={() => {onClose(); onRoaster();}}/>
                <SettingsSheetRow icon={BadgeHelp} label="Help & Support" onClick={() => {onClose(); onSupport();}}/>
                {isStaff && (
                    <SettingsSheetRow icon={Shield} label="Admin" onClick={() => {onClose(); navigate("/admin/site-settings");}}/>
                )}
            </div>
            <div className="mt-1 mb-1 border-t border-ink-950/10 dark:border-white/10 pt-1">
                <SettingsSheetRow icon={LogOut} label="Log out" danger onClick={() => navigate("/logout")} trailing={null}/>
            </div>
        </DockPanel>
    );
}

export default function BottomNav() {
    const [showLogWorkout, setShowLogWorkout] = useState(false);
    const [showCreateChallenge, setShowCreateChallenge] = useState(false);
    const [showCompetitionPicker, setShowCompetitionPicker] = useState(false);
    const [showSettingsSheet, setShowSettingsSheet] = useState(false);
    // Modal state lives here (not inside SettingsSheet) so closing the sheet
    // doesn't unmount the modal it was supposed to open.
    const [showSettings, setShowSettings] = useState(false);
    const [showEqualizer, setShowEqualizer] = useState(false);
    const [showSupport, setShowSupport] = useState(false);
    const [showRoaster, setShowRoaster] = useState(false);
    const [linkStrava, setLinkStrava] = useState(false);

    const location = useLocation();
    const navigate = useNavigate();
    // Hide the bar (and skip its API hooks) on public pages. Without
    // skip, `me` fired unauthenticated on /login and logged a 401 on
    // every visit - CrowdSec http-auth-bf counts those. Trailing
    // slashes (/login/) used to miss the exact-path check, so the dock
    // sat on the login screen.
    const onPublic = isPublicPath(location.pathname);
    const {data: user, error: userError, refetch: refetchUser} = useGetUserByIdQuery('me', {skip: onPublic});
    const {data: competitions} = useGetCompetitionsQuery(undefined, {skip: onPublic || !user});
    const {data: drillConfigs} = useGetDrillConfigsQuery(undefined, {skip: onPublic || !user});
    const isStaff = !!user?.is_staff;

    // Keep the native Health Connect background sync aligned with the
    // effective activity source - including switches the user made on
    // another device (browser picks up here on the next app start).
    useEffect(() => {
        if (user?.activity_source_effective && isNativeHealthAvailable()) {
            nativeHealthSetSource(user.activity_source_effective, user?.health_public_url);
        }
    }, [user?.activity_source_effective, user?.health_public_url]);

    // Native coach pings: Android notifications for new coach messages
    // (Web Push does not work inside the WebView) - runs while logged in.
    useEffect(() => {
        if (!user) return undefined;
        return startNativeCoachPings(user);
    }, [user?.id, user?.first_name]);

    // Keep the access token fresh in the background so polling never
    // expires mid-flight (a 5–15 min JWT + 8 pollers = a 401 burst).
    useEffect(() => {
        if (!user) return undefined;
        const tick = () => { ensureFreshAccessToken(); };
        tick();
        const id = setInterval(tick, 30000);
        const stopResume = onAppResume(tick);
        return () => {
            clearInterval(id);
            stopResume();
        };
    }, [user?.id]);
    const onDashboard = location.pathname === "/dashboard" || location.pathname === "/dashboard/";
    const onCompetition = location.pathname.startsWith("/competition/");
    const onCoach = location.pathname.startsWith("/coach");
    const onAdmin = location.pathname.startsWith("/admin/");

    // The coach's face in the centre of the bar: persona of the most
    // recently active enabled Drill Instructor config.
    const coachPersona = React.useMemo(() => {
        const active = (drillConfigs || []).filter((c) => c.enabled && c.persona_detail);
        if (active.length === 0) return COACH_FALLBACK;
        active.sort((a, b) => new Date(b.last_posted_at || 0) - new Date(a.last_posted_at || 0));
        return active[0].persona_detail;
    }, [drillConfigs]);

    if (onPublic || !user) {
        return null;
    }

    const sheetOpen = showCompetitionPicker || showSettingsSheet;
    const closeSheets = () => {
        setShowCompetitionPicker(false);
        setShowSettingsSheet(false);
    };

    return (
        <>
            {sheetOpen && (
                <div className="fixed inset-0 z-40 bg-ink-950/30 dark:bg-black/45 backdrop-blur-[2px]"
                     onClick={closeSheets} aria-hidden="true"/>
            )}
            <nav className="fixed inset-x-0 bottom-0 z-40 overflow-visible animate-nav-rise pointer-events-none pb-[max(0.5rem,env(safe-area-inset-bottom))] md:bottom-5 md:pb-0"
                 aria-label="Primary navigation">
                {/* One glass capsule: the dock, and when open the panel
                    grows up from it as the same piece of frost. */}
                <div className={"glass-dock pointer-events-auto mx-3 flex flex-col md:mx-auto " +
                    (sheetOpen
                        ? "overflow-hidden rounded-[1.75rem] md:w-full md:max-w-md"
                        : "overflow-visible rounded-[1.75rem] md:w-max md:rounded-full")}>
                    <span className="glass-sheen rounded-[inherit]" aria-hidden="true"/>
                    {showCompetitionPicker && (
                        <CompetitionPickerPanel onClose={closeSheets}
                                                onCreate={() => setShowCreateChallenge(true)}/>
                    )}
                    {showSettingsSheet && (
                        <SettingsPanel
                            onClose={closeSheets} user={user} isStaff={isStaff}
                            onAccount={() => setShowSettings(true)}
                            onEqualizer={() => setShowEqualizer(true)}
                            onRoaster={() => setShowRoaster(true)}
                            onSupport={() => setShowSupport(true)}/>
                    )}
                    {sheetOpen && <div className="mx-5 h-px shrink-0 bg-ink-950/10 dark:bg-white/10" aria-hidden="true"/>}
                    <div className="relative flex items-stretch justify-around px-1 py-0.5 md:gap-1 md:px-4">
                    <NavLink to="/dashboard" icon={Home} label="Home" isActive={onDashboard} onClick={closeSheets}/>

                    <NavLink
                        to="#"
                        icon={Flag}
                        label="Compete"
                        isActive={onCompetition || showCompetitionPicker}
                        onClick={() => {
                            setShowSettingsSheet(false);
                            const one = primaryChallenge(competitions);
                            if (one) navigate(`/competition/${one.id}`);
                            else setShowCompetitionPicker((v) => !v);
                        }}
                    />

                    {/* Centre stage: the Coach sits in a glass lens above the bar.
                        Flattened into the row while a dock panel is open. */}
                    <Link to="/coach"
                          onClick={closeSheets}
                          className={"relative z-10 flex flex-col items-center justify-center min-h-[44px] px-2 transition-[margin] duration-300 " +
                              (sheetOpen ? "" : "-mt-8 md:-mt-9")}
                          aria-label="Coach"
                          aria-current={onCoach ? "page" : undefined}>
                        <span className="relative">
                            <span aria-hidden="true"
                                  className="absolute -inset-2.5 rounded-full blur-md animate-volt-breathe"
                                  style={{backgroundColor: coachAccentRgba(coachPersona, 0.28)}}/>
                            <span className={"relative block rounded-full transition active:scale-95 " +
                                (onCoach ? "animate-pulse-ring" : "")}
                                  style={{
                                      boxShadow: `0 0 0 2px ${coachAccent(coachPersona)}, 0 0 16px ${coachAccentRgba(coachPersona, 0.55)}`,
                                      "--pulse-ring-color": coachAccentRgba(coachPersona, 0.55),
                                  }}>
                                <PersonaAvatar persona={coachPersona} size={58} glow/>
                            </span>
                        </span>
                        <span className="text-[10px] font-bold leading-none mt-1.5 tracking-widest uppercase md:hidden"
                              style={{color: coachAccent(coachPersona), opacity: onCoach ? 1 : 0.75}}>
                            Coach
                        </span>
                    </Link>

                    <NavLink
                        to="#"
                        icon={Plus}
                        label="Log"
                        isActive={showLogWorkout}
                        onClick={() => { closeSheets(); setShowLogWorkout(true); }}
                    />

                    <NavLink
                        to="#"
                        icon={Settings}
                        label="Settings"
                        isActive={onAdmin || showSettingsSheet}
                        onClick={() => {
                            setShowCompetitionPicker(false);
                            setShowSettingsSheet((v) => !v);
                        }}
                    />
                    </div>
                </div>
            </nav>

            {showLogWorkout && user && (
                <WorkoutForm setModalState={setShowLogWorkout}
                             scaling_distance={parseFloat(user?.scaling_distance || "1.0")}/>
            )}
            {showCreateChallenge && <CompetitionForm setModalState={setShowCreateChallenge}/>}

            {/* Account form needs the profile. While it is still loading
                (or after a failed fetch) show feedback inside the modal
                instead of the tap on "Account" silently doing nothing. */}
            {showSettings && (user ? (
                <SettingsForm user={user} setModalState={setShowSettings} setLinkStrava={setLinkStrava}/>
            ) : (
                <Modal title="Account" landscape={true} setShowModal={setShowSettings} isLoading={!userError}>
                    <div className="text-center space-y-3 px-4">
                        <p className="text-red-500 text-sm">Your profile could not be loaded.</p>
                        <button onClick={() => refetchUser()}
                                className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold uppercase tracking-wide transition">
                            Try again
                        </button>
                    </div>
                </Modal>
            ))}
            {showEqualizer && user && <GoalEqualizerForm user={user} setModalState={setShowEqualizer}/>}
            {showRoaster && <RoasterModal setShowModal={setShowRoaster}/>}
            {showSupport && <SupportModal setModalState={setShowSupport}/>}
            {linkStrava && <LinkStravaScreen setModal={setLinkStrava}/>}
        </>
    );
}

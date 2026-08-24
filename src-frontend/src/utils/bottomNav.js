import React, {useEffect, useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {Flag, Home, Plus, User2, Settings, Scale, BadgeHelp, Shield, LogOut, Sun, Moon, Monitor, ChevronRight, Bot} from "lucide-react";
import WorkoutForm from "../forms/workoutForm";
import {Modal} from "../forms/basicComponents";
import SettingsForm from "../forms/settingsForm";
import GoalEqualizerForm from "../forms/equalizerForm";
import SupportModal from "../forms/supportModal";
import {LinkStravaScreen} from "../pages/HowTo";
import RoasterModal from "../components/RoasterBox";
import PersonaAvatar from "../components/PersonaAvatar";
import ProfileAvatar from "../components/ProfileAvatar";
import {DogTagRow} from "../components/gameBits";
import {useTheme} from "./theme";
import {isNativeHealthAvailable, nativeHealthSetSource} from "./nativeHealth";
import {startNativeCoachPings} from "./nativeCoachPings";
import {useGetUserByIdQuery} from "./reducers/usersSlice";
import {useGetCompetitionsQuery} from "./reducers/competitionsSlice";
import {useGetDrillConfigsQuery} from "./reducers/drillInstructorSlice";
import {ensureFreshAccessToken} from "./authTokens";
import {primaryChallenge} from "./challenge";


const COACH_FALLBACK = {name: "Coach", avatar: "megaphone", theme_color: "#d7ff3e"};

function NavLink({to, icon: Icon, label, isActive, onClick}) {
    const className =
        "relative flex flex-col items-center justify-center gap-1 py-2 px-2.5 min-w-[56px] min-h-[58px] transition-colors duration-200 " +
        (isActive ? "text-ink-950 dark:text-volt-200" : "text-ink-700/55 dark:text-gray-400 hover:text-ink-900 dark:hover:text-volt-200");
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
    if (onClick) {
        return (
            <button onClick={onClick} className={className} aria-label={label} aria-current={isActive ? "page" : undefined}>
                {inner}
            </button>
        );
    }
    return (
        <Link to={to} className={className} aria-label={label} aria-current={isActive ? "page" : undefined}>
            {inner}
        </Link>
    );
}

function Sheet({onClose, title, children}) {
    return (
        <div className="fixed inset-0 z-50 bg-ink-950/35 dark:bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
            <div className="glass-sheet absolute bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:max-w-md text-ink-950 dark:text-white rounded-t-3xl md:rounded-3xl md:bottom-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-slide-up overflow-hidden"
                 onClick={(e) => e.stopPropagation()}>
                <span className="glass-sheen" aria-hidden="true"/>
                <div className="relative">
                    <div className="w-12 h-1.5 bg-ink-950/20 dark:bg-white/25 rounded-full mx-auto mb-4 md:hidden"/>
                    <h3 className="font-display text-sm uppercase tracking-wider mb-3">{title}</h3>
                    {children}
                </div>
            </div>
        </div>
    );
}

function CompetitionPickerSheet({setShowCompetitionPicker}) {
    const {data: competitions, isSuccess} = useGetCompetitionsQuery();
    const navigate = useNavigate();

    return (
        <Sheet onClose={() => setShowCompetitionPicker(false)} title="Your challenges">
            <div className="space-y-1 max-h-72 overflow-y-auto">
                {(competitions || []).map((c) => (
                    <button key={c.id}
                            onClick={() => {setShowCompetitionPicker(false); navigate(`/competition/${c.id}`);}}
                            className="w-full text-left px-3 py-3 rounded-2xl hover:bg-ink-950/8 dark:hover:bg-white/10 min-h-[44px]">
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-xs text-gray-400">{c.start_date_fmt} – {c.end_date_fmt}</div>
                    </button>
                ))}
                {isSuccess && competitions?.length === 0 && (
                    <div className="text-sm text-gray-400 px-3 py-2">No challenges yet.</div>
                )}
            </div>
            <button
                onClick={() => {setShowCompetitionPicker(false); navigate("/dashboard");}}
                className="w-full mt-3 px-3 py-3 rounded-2xl bg-volt-400 text-ink-950 font-bold uppercase tracking-wide text-sm min-h-[44px]">
                + Create a challenge
            </button>
        </Sheet>
    );
}

function SettingsSheetRow({icon: Icon, label, onClick, danger = false, trailing = null}) {
    return (
        <button onClick={onClick}
                className={"w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-ink-950/8 dark:hover:bg-white/10 min-h-[44px] text-left " + (danger ? "text-red-500 dark:text-red-400" : "")}>
            <Icon className="h-5 w-5 shrink-0"/>
            <span className="flex-1 font-semibold text-sm">{label}</span>
            {trailing || <ChevronRight className="h-4 w-4 text-gray-500"/>}
        </button>
    );
}

function SettingsSheet({setShowSettingsSheet, user, isStaff, onAccount, onEqualizer, onRoaster, onSupport}) {
    const navigate = useNavigate();
    const {theme, resolvedTheme, cycle} = useTheme();
    const themeLabel = theme === "system"
        ? `Match device (${resolvedTheme})`
        : theme === "dark" ? "Dark mode" : "Light mode";
    const ThemeIcon = theme === "system" ? Monitor : (resolvedTheme === "dark" ? Sun : Moon);

    const close = () => setShowSettingsSheet(false);

    return (
        <Sheet onClose={close} title="Settings">
            <div className="flex items-center gap-3 px-3 pb-3 mb-2 border-b border-ink-950/10 dark:border-white/10">
                <ProfileAvatar user={user} size={52} editable/>
                <div className="min-w-0">
                    <p className="font-bold truncate">{user?.first_name} {user?.last_name}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                    <DogTagRow tags={user?.dog_tags}/>
                </div>
            </div>
            <div className="space-y-1">
                <SettingsSheetRow icon={User2} label="Account" onClick={() => {close(); onAccount();}}/>
                <SettingsSheetRow icon={Scale} label="Goal Equalizer" onClick={() => {close(); onEqualizer();}}/>
                <SettingsSheetRow icon={Bot} label="The roaster" onClick={() => {close(); onRoaster();}}/>
                <SettingsSheetRow
                    icon={ThemeIcon}
                    label={themeLabel}
                    onClick={cycle}
                    trailing={null}
                />
                <SettingsSheetRow icon={BadgeHelp} label="Help & Support" onClick={() => {close(); onSupport();}}/>
                {isStaff && (
                    <SettingsSheetRow icon={Shield} label="Admin" onClick={() => {close(); navigate("/admin/site-settings");}}/>
                )}
                <SettingsSheetRow icon={LogOut} label="Log out" danger onClick={() => navigate("/logout")}/>
            </div>
        </Sheet>
    );
}

export default function BottomNav() {
    const [showLogWorkout, setShowLogWorkout] = useState(false);
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
    // every visit - CrowdSec http-auth-bf counts those.
    const publicPaths = ["/", "/login", "/signup", "/logout", "/password"];
    const onPublic = publicPaths.some((p) => location.pathname === p || location.pathname.startsWith("/password"));
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
        return startNativeCoachPings();
    }, [user?.id]);

    // Keep the access token fresh in the background so polling never
    // expires mid-flight (a 5–15 min JWT + 8 pollers = a 401 burst).
    useEffect(() => {
        if (!user) return undefined;
        const tick = () => { ensureFreshAccessToken(); };
        tick();
        const id = setInterval(tick, 30000);
        const onVis = () => { if (document.visibilityState === "visible") tick(); };
        document.addEventListener("visibilitychange", onVis);
        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [user?.id]);
    const onDashboard = location.pathname === "/dashboard" || location.pathname === "/";
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

    if (onPublic) {
        return null;
    }

    return (
        <>
            <nav className="fixed inset-x-0 bottom-0 z-40 overflow-visible animate-nav-rise pointer-events-none pb-[max(0.5rem,env(safe-area-inset-bottom))] md:bottom-5 md:pb-0"
                 aria-label="Primary navigation">
                {/* Floating glass capsule. mx-auto (not translateX) so
                    animate-nav-rise's transform cannot un-centre the dock. */}
                <div className="glass-dock pointer-events-auto mx-3 flex items-stretch justify-around overflow-visible rounded-[1.75rem] px-1 md:mx-auto md:w-max md:gap-1 md:rounded-full md:px-4">
                    <span className="glass-sheen rounded-[inherit]" aria-hidden="true"/>
                    <NavLink to="/dashboard" icon={Home} label="Home" isActive={onDashboard}/>

                    <NavLink
                        to="#"
                        icon={Flag}
                        label="Compete"
                        isActive={onCompetition || showCompetitionPicker}
                        onClick={() => {
                            const one = primaryChallenge(competitions);
                            if (one) navigate(`/competition/${one.id}`);
                            else setShowCompetitionPicker(true);
                        }}
                    />

                    {/* Centre stage: the Coach sits in a glass lens above the bar. */}
                    <Link to="/coach"
                          className="relative z-10 flex flex-col items-center justify-center -mt-8 md:-mt-9 min-h-[44px] px-2"
                          aria-label="Coach"
                          aria-current={onCoach ? "page" : undefined}>
                        <span className="relative">
                            <span aria-hidden="true"
                                  className="absolute -inset-2.5 rounded-full bg-volt-400/25 blur-md animate-volt-breathe"/>
                            <span className={"relative block rounded-full ring-2 ring-white/70 dark:ring-volt-400 shadow-glow-volt transition active:scale-95 " +
                                (onCoach ? "animate-pulse-ring" : "")}>
                                <PersonaAvatar persona={coachPersona} size={58} glow/>
                            </span>
                        </span>
                        <span className={"text-[10px] font-bold leading-none mt-1.5 tracking-widest uppercase md:hidden " +
                            (onCoach ? "text-volt-700 dark:text-volt-400" : "text-ink-700/55 dark:text-gray-400")}>
                            Coach
                        </span>
                    </Link>

                    <NavLink
                        to="#"
                        icon={Plus}
                        label="Log"
                        isActive={showLogWorkout}
                        onClick={() => setShowLogWorkout(true)}
                    />

                    <NavLink
                        to="#"
                        icon={Settings}
                        label="Settings"
                        isActive={onAdmin || showSettingsSheet}
                        onClick={() => setShowSettingsSheet(true)}
                    />
                </div>
            </nav>

            {showLogWorkout && user && (
                <WorkoutForm setModalState={setShowLogWorkout}
                             scaling_distance={parseFloat(user?.scaling_distance || "1.0")}/>
            )}

            {showCompetitionPicker && (
                <CompetitionPickerSheet setShowCompetitionPicker={setShowCompetitionPicker}/>
            )}

            {showSettingsSheet && (
                <SettingsSheet setShowSettingsSheet={setShowSettingsSheet} user={user} isStaff={isStaff}
                         onAccount={() => setShowSettings(true)}
                         onEqualizer={() => setShowEqualizer(true)}
                         onRoaster={() => setShowRoaster(true)}
                         onSupport={() => setShowSupport(true)}/>
            )}

            {/* Account form needs the profile. While it is still loading
                (or after a failed fetch) show feedback inside the modal
                instead of the tap on "Account" silently doing nothing. */}
            {showSettings && (user ? (
                <SettingsForm user={user} setModalState={setShowSettings} setLinkStrava={setLinkStrava}/>
            ) : (
                <Modal title="Personal Setting" landscape={true} setShowModal={setShowSettings} isLoading={!userError}>
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

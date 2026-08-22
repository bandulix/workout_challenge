import React, {useEffect, useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {Flag, Home, Plus, User2, Settings, Scale, BadgeHelp, Shield, LogOut, Sun, Moon, ChevronRight} from "lucide-react";
import WorkoutForm from "../forms/workoutForm";
import {Modal} from "../forms/basicComponents";
import SettingsForm from "../forms/settingsForm";
import GoalEqualizerForm from "../forms/equalizerForm";
import SupportModal from "../forms/supportModal";
import {LinkStravaScreen} from "../pages/HowTo";
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


const COACH_FALLBACK = {name: "Coach", avatar: "megaphone", theme_color: "#d7ff3e"};

function NavLink({to, icon: Icon, label, isActive, onClick}) {
    const className =
        "relative flex flex-col items-center justify-center gap-1 py-2 px-2.5 min-w-[56px] min-h-[52px] transition-colors duration-200 " +
        (isActive ? "text-ink-950" : "text-gray-400 hover:text-volt-200");
    const inner = (
        <>
            <span aria-hidden="true"
                  className={"absolute inset-x-1.5 inset-y-1 rounded-2xl transition-all duration-300 " +
                      (isActive ? "bg-volt-400 shadow-glow-volt scale-100" : "bg-transparent scale-90")}/>
            <Icon className={"relative z-10 h-5 w-5 transition-transform duration-300 " + (isActive ? "scale-110" : "")}
                  strokeWidth={isActive ? 2.4 : 1.8}
                  fill={isActive ? "currentColor" : "none"}/>
            <span className={"relative z-10 text-[10px] font-bold uppercase tracking-wider leading-none " +
                (isActive ? "text-ink-950" : "")}>{label}</span>
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="absolute bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:max-w-md bg-ink-900 text-white border-t md:border border-ink-700/60 rounded-t-3xl md:rounded-3xl md:bottom-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl animate-slide-up"
                 onClick={(e) => e.stopPropagation()}>
                <div className="w-12 h-1.5 bg-ink-600 rounded-full mx-auto mb-4 md:hidden"/>
                <h3 className="font-display text-sm uppercase tracking-wider mb-3">{title}</h3>
                {children}
            </div>
        </div>
    );
}

function CompetitionPickerSheet({setShowCompetitionPicker}) {
    const {data: competitions, isSuccess} = useGetCompetitionsQuery();
    const navigate = useNavigate();

    return (
        <Sheet onClose={() => setShowCompetitionPicker(false)} title="Your competitions">
            <div className="space-y-1 max-h-72 overflow-y-auto">
                {(competitions || []).map((c) => (
                    <button key={c.id}
                            onClick={() => {setShowCompetitionPicker(false); navigate(`/competition/${c.id}`);}}
                            className="w-full text-left px-3 py-3 rounded-2xl hover:bg-ink-800 min-h-[44px]">
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-xs text-gray-400">{c.start_date_fmt} – {c.end_date_fmt}</div>
                    </button>
                ))}
                {isSuccess && competitions?.length === 0 && (
                    <div className="text-sm text-gray-400 px-3 py-2">No competitions yet.</div>
                )}
            </div>
            <button
                onClick={() => {setShowCompetitionPicker(false); navigate("/dashboard");}}
                className="w-full mt-3 px-3 py-3 rounded-2xl bg-volt-400 text-ink-950 font-bold uppercase tracking-wide text-sm min-h-[44px]">
                + Create a new competition
            </button>
        </Sheet>
    );
}

function MeSheetRow({icon: Icon, label, onClick, danger = false, trailing = null}) {
    return (
        <button onClick={onClick}
                className={"w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-ink-800 min-h-[44px] text-left " + (danger ? "text-red-400" : "")}>
            <Icon className="h-5 w-5 shrink-0"/>
            <span className="flex-1 font-semibold text-sm">{label}</span>
            {trailing || <ChevronRight className="h-4 w-4 text-gray-500"/>}
        </button>
    );
}

function MeSheet({setShowMeSheet, user, isStaff, onSettings, onEqualizer, onSupport}) {
    const navigate = useNavigate();
    const {resolvedTheme, toggle} = useTheme();

    const close = () => setShowMeSheet(false);

    return (
        <Sheet onClose={close} title="Me">
            <div className="flex items-center gap-3 px-3 pb-3 mb-2 border-b border-ink-700/60">
                <ProfileAvatar user={user} size={52} editable/>
                <div className="min-w-0">
                    <p className="font-bold truncate">{user?.first_name} {user?.last_name}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                    <DogTagRow tags={user?.dog_tags}/>
                </div>
            </div>
            <div className="space-y-1">
                <MeSheetRow icon={Settings} label="Settings" onClick={() => {close(); onSettings();}}/>
                <MeSheetRow icon={Scale} label="Goal Equalizer" onClick={() => {close(); onEqualizer();}}/>
                <MeSheetRow
                    icon={resolvedTheme === "dark" ? Sun : Moon}
                    label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    onClick={toggle}
                    trailing={null}
                />
                <MeSheetRow icon={BadgeHelp} label="Help & Support" onClick={() => {close(); onSupport();}}/>
                {isStaff && (
                    <MeSheetRow icon={Shield} label="Admin" onClick={() => {close(); navigate("/admin/site-settings");}}/>
                )}
                <MeSheetRow icon={LogOut} label="Log out" danger onClick={() => navigate("/logout")}/>
            </div>
        </Sheet>
    );
}

export default function BottomNav() {
    const [showLogWorkout, setShowLogWorkout] = useState(false);
    const [showCompetitionPicker, setShowCompetitionPicker] = useState(false);
    const [showMeSheet, setShowMeSheet] = useState(false);
    // Modal state lives here (not inside MeSheet) so closing the sheet
    // doesn't unmount the modal it was supposed to open.
    const [showSettings, setShowSettings] = useState(false);
    const [showEqualizer, setShowEqualizer] = useState(false);
    const [showSupport, setShowSupport] = useState(false);
    const [linkStrava, setLinkStrava] = useState(false);

    const location = useLocation();
    // Hide the bar (and skip its API hooks) on public pages. Without
    // skip, `me` fired unauthenticated on /login and logged a 401 on
    // every visit - CrowdSec http-auth-bf counts those.
    const publicPaths = ["/", "/login", "/signup", "/logout", "/password"];
    const onPublic = publicPaths.some((p) => location.pathname === p || location.pathname.startsWith("/password"));
    const {data: user, error: userError, refetch: refetchUser} = useGetUserByIdQuery('me', {skip: onPublic});
    const {data: drillConfigs} = useGetDrillConfigsQuery(undefined, {skip: onPublic || !user});
    const isStaff = !!user?.is_staff;

    // Keep the native Health Connect background sync aligned with the
    // effective activity source - including switches the user made on
    // another device (browser picks up here on the next app start).
    useEffect(() => {
        if (user?.activity_source_effective && isNativeHealthAvailable()) {
            nativeHealthSetSource(user.activity_source_effective);
        }
    }, [user?.activity_source_effective]);

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
            <nav className="fixed bottom-0 left-0 right-0 z-40 overflow-visible bg-ink-950/90 backdrop-blur-xl border-t border-volt-400/30 shadow-[0_-16px_48px_rgba(215,255,62,0.12)] pb-[env(safe-area-inset-bottom)] animate-nav-rise md:bottom-5 md:left-1/2 md:right-auto md:-translate-x-1/2 md:rounded-full md:border md:border-volt-400/40 md:px-4 md:pb-0 md:shadow-glow-volt"
                 aria-label="Primary navigation">
                <div className="flex items-stretch justify-around md:gap-1">
                    <NavLink to="/dashboard" icon={Home} label="Home" isActive={onDashboard}/>

                    <NavLink
                        to="#"
                        icon={Flag}
                        label="Compete"
                        isActive={onCompetition || showCompetitionPicker}
                        onClick={() => setShowCompetitionPicker(true)}
                    />

                    {/* Centre stage: the Coach */}
                    <Link to="/coach"
                          className="flex flex-col items-center justify-center -mt-9 md:-mt-10 min-h-[44px] px-2"
                          aria-label="Coach"
                          aria-current={onCoach ? "page" : undefined}>
                        <span className="relative">
                            <span aria-hidden="true"
                                  className="absolute -inset-2 rounded-full bg-volt-400/30 blur-md animate-volt-breathe"/>
                            <span className={"relative block rounded-full ring-2 ring-volt-400 shadow-glow-volt transition active:scale-95 " +
                                (onCoach ? "animate-pulse-ring" : "")}>
                                <PersonaAvatar persona={coachPersona} size={58} glow/>
                            </span>
                        </span>
                        <span className={"text-[10px] font-bold leading-none mt-1.5 tracking-widest uppercase md:hidden " +
                            (onCoach ? "text-volt-400" : "text-gray-400")}>
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
                        icon={User2}
                        label="Me"
                        isActive={onAdmin || showMeSheet}
                        onClick={() => setShowMeSheet(true)}
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

            {showMeSheet && (
                <MeSheet setShowMeSheet={setShowMeSheet} user={user} isStaff={isStaff}
                         onSettings={() => setShowSettings(true)}
                         onEqualizer={() => setShowEqualizer(true)}
                         onSupport={() => setShowSupport(true)}/>
            )}

            {/* SettingsForm needs the profile. While it is still loading
                (or after a failed fetch) show feedback inside the modal
                instead of the tap on "Settings" silently doing nothing. */}
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
            {showSupport && <SupportModal setModalState={setShowSupport}/>}
            {linkStrava && <LinkStravaScreen setModal={setLinkStrava}/>}
        </>
    );
}

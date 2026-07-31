import React, {useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {Flag, Home, Plus, User2, Settings, Scale, BadgeHelp, Shield, LogOut, Sun, Moon, ChevronRight} from "lucide-react";
import WorkoutForm from "../forms/workoutForm";
import SettingsForm from "../forms/settingsForm";
import GoalEqualizerForm from "../forms/equalizerForm";
import SupportModal from "../forms/supportModal";
import {LinkStravaScreen} from "../pages/HowTo";
import PersonaAvatar from "../components/PersonaAvatar";
import ProfileAvatar from "../components/ProfileAvatar";
import {useTheme} from "./theme";
import {useGetUserByIdQuery} from "./reducers/usersSlice";
import {useGetCompetitionsQuery} from "./reducers/competitionsSlice";
import {useGetDrillConfigsQuery} from "./reducers/drillInstructorSlice";


const COACH_FALLBACK = {name: "Coach", avatar: "megaphone", theme_color: "#d7ff3e"};

function NavLink({to, icon: Icon, label, isActive, onClick}) {
    const className =
        "flex flex-col items-center justify-center gap-1 py-2 px-3 min-w-[56px] min-h-[44px] transition-colors " +
        (isActive ? "text-volt-400" : "text-gray-400 hover:text-gray-200");
    if (onClick) {
        return (
            <button onClick={onClick} className={className} aria-label={label}>
                <Icon className="h-5 w-5"/>
                <span className="text-[10px] font-semibold leading-none">{label}</span>
            </button>
        );
    }
    return (
        <Link to={to} className={className} aria-label={label}>
            <Icon className="h-5 w-5"/>
            <span className="text-[10px] font-semibold leading-none">{label}</span>
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
    const {data: user} = useGetUserByIdQuery('me');
    const {data: drillConfigs} = useGetDrillConfigsQuery(undefined, {skip: !user});
    const isStaff = !!user?.is_staff;
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

    // Hide the bar entirely on the public (logged-out) pages.
    const publicPaths = ["/", "/login", "/signup", "/logout", "/password"];
    if (!localStorage.getItem("access_token") && publicPaths.some((p) => location.pathname === p || location.pathname.startsWith("/password"))) {
        return null;
    }

    return (
        <>
            <nav className="fixed bottom-0 left-0 right-0 z-40 bg-ink-950/95 backdrop-blur border-t border-ink-700/60 pb-[env(safe-area-inset-bottom)] md:bottom-4 md:left-1/2 md:right-auto md:-translate-x-1/2 md:rounded-full md:border md:px-3 md:pb-0 md:shadow-card-dark"
                 aria-label="Primary navigation">
                <div className="flex items-stretch justify-around">
                    <NavLink to="/dashboard" icon={Home} label="Home" isActive={onDashboard}/>

                    <NavLink
                        to="#"
                        icon={Flag}
                        label="Compete"
                        isActive={onCompetition}
                        onClick={() => setShowCompetitionPicker(true)}
                    />

                    {/* Centre stage: the Coach */}
                    <Link to="/coach"
                          className="flex flex-col items-center justify-center -mt-8 md:-mt-9 min-h-[44px] px-2"
                          aria-label="Coach">
                        <span className={"transition active:scale-95 rounded-full " + (onCoach ? "animate-pulse-ring" : "")}>
                            <PersonaAvatar persona={coachPersona} size={56} glow={onCoach}/>
                        </span>
                        <span className={"text-[10px] font-bold leading-none mt-1.5 tracking-widest md:hidden " + (onCoach ? "text-volt-400" : "text-gray-400")}>
                            COACH
                        </span>
                    </Link>

                    <NavLink
                        to="#"
                        icon={Plus}
                        label="Log"
                        isActive={false}
                        onClick={() => setShowLogWorkout(true)}
                    />

                    <NavLink
                        to="#"
                        icon={User2}
                        label="Me"
                        isActive={onAdmin}
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

            {showSettings && user && <SettingsForm user={user} setModalState={setShowSettings} setLinkStrava={setLinkStrava}/>}
            {showEqualizer && user && <GoalEqualizerForm user={user} setModalState={setShowEqualizer}/>}
            {showSupport && <SupportModal setModalState={setShowSupport}/>}
            {linkStrava && <LinkStravaScreen setModal={setLinkStrava}/>}
        </>
    );
}

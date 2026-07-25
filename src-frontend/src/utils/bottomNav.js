import React, {useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {Flag, Home, Plus, Shield, User2} from "lucide-react";
import WorkoutForm from "../forms/workoutForm";
import CompetitionForm from "../forms/competitionForm";
import {useGetUserByIdQuery} from "./reducers/usersSlice";
import {useGetCompetitionsQuery} from "./reducers/competitionsSlice";


function NavLink({to, icon: Icon, label, isActive, onClick}) {
    const className =
        "flex flex-col items-center justify-center gap-1 py-2 px-3 min-w-[64px] min-h-[44px] " +
        (isActive ? "text-sky-700 dark:text-sky-300" : "text-gray-500 dark:text-gray-400");
    if (onClick) {
        return (
            <button onClick={onClick} className={className} aria-label={label}>
                <Icon className="h-5 w-5"/>
                <span className="text-[10px] font-medium leading-none">{label}</span>
            </button>
        );
    }
    return (
        <Link to={to} className={className} aria-label={label}>
            <Icon className="h-5 w-5"/>
            <span className="text-[10px] font-medium leading-none">{label}</span>
        </Link>
    );
}

function CompetitionPickerSheet({setShowCompetitionPicker}) {
    const {data: competitions, isSuccess} = useGetCompetitionsQuery();
    const navigate = useNavigate();

    return (
        <div className="fixed inset-0 z-50 bg-black/40 md:hidden"
             onClick={() => setShowCompetitionPicker(false)}>
            <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
                 onClick={(e) => e.stopPropagation()}>
                <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-4"/>
                <h3 className="text-lg font-semibold mb-3">Your competitions</h3>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                    {(competitions || []).map((c) => (
                        <button key={c.id}
                                onClick={() => {setShowCompetitionPicker(false); navigate(`/competition/${c.id}`);}}
                                className="w-full text-left px-3 py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px]">
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-gray-500">{c.start_date_fmt} – {c.end_date_fmt}</div>
                        </button>
                    ))}
                    {isSuccess && competitions?.length === 0 && (
                        <div className="text-sm text-gray-500 px-3 py-2">No competitions yet.</div>
                    )}
                </div>
                <button
                    onClick={() => {setShowCompetitionPicker(false); navigate("/dashboard");}}
                    className="w-full mt-3 px-3 py-3 rounded-lg bg-sky-700 text-white font-medium min-h-[44px]">
                    + Create a new competition (open Dashboard)
                </button>
            </div>
        </div>
    );
}

export default function BottomNav() {
    const [showLogWorkout, setShowLogWorkout] = useState(false);
    const [showCompetitionPicker, setShowCompetitionPicker] = useState(false);
    const [showCreateCompetition, setShowCreateCompetition] = useState(false);

    const location = useLocation();
    const {data: user} = useGetUserByIdQuery('me');
    const isStaff = !!user?.is_staff;
    const onDashboard = location.pathname === "/dashboard" || location.pathname === "/";
    const onCompetition = location.pathname.startsWith("/competition/");
    const onAdmin = location.pathname.startsWith("/admin/");

    return (
        <>
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 pb-[env(safe-area-inset-bottom)]"
                 aria-label="Primary mobile navigation">
                <div className="flex items-stretch justify-around">
                    <NavLink to="/dashboard" icon={Home} label="Home" isActive={onDashboard}/>

                    <NavLink
                        to="#"
                        icon={Flag}
                        label="Compete"
                        isActive={onCompetition}
                        onClick={() => setShowCompetitionPicker(true)}
                    />

                    {/* FAB - Log Workout */}
                    <button
                        onClick={() => setShowLogWorkout(true)}
                        className="flex flex-col items-center justify-center -mt-7 min-h-[44px]"
                        aria-label="Log workout">
                        <span className="flex items-center justify-center h-14 w-14 rounded-full bg-sky-700 text-white shadow-lg hover:bg-sky-600 active:scale-95 transition">
                            <Plus className="h-7 w-7"/>
                        </span>
                        <span className="text-[10px] font-medium leading-none mt-1 text-sky-700 dark:text-sky-300">Log</span>
                    </button>

                    {isStaff ? (
                        <NavLink to="/admin/site-settings" icon={Shield} label="Admin" isActive={onAdmin}/>
                    ) : (
                        <NavLink to="/dashboard" icon={User2} label="Me" isActive={false}/>
                    )}
                </div>
            </nav>

            {showLogWorkout && user && (
                <WorkoutForm setModalState={setShowLogWorkout}
                             scaling_distance={parseFloat(user?.scaling_distance || "1.0")}/>
            )}

            {showCompetitionPicker && (
                <CompetitionPickerSheet setShowCompetitionPicker={setShowCompetitionPicker}/>
            )}

            {showCreateCompetition && (
                <CompetitionForm setModalState={setShowCreateCompetition}
                                 setShowTransferCompetitionModal={() => {}}/>
            )}
        </>
    );
}
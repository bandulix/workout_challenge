import {useGetCompetitionsQuery} from "./reducers/competitionsSlice";
import {useGetUserByIdQuery} from "./reducers/usersSlice";
import {Link} from "react-router-dom";
import React, {useState} from "react";
import CompetitionForm from "../forms/competitionForm";
import {LogOut, BadgeHelp, Shield} from "lucide-react";
import SupportModal from "../forms/supportModal";

export default function NavMenu({page}) {
    const [showEditCompetitionModal, setShowEditCompetitionModal] = useState(false);
    const [showSupportModal, setShowSupportModal] = useState(false);

    const {
        data: competitions,
        error: competitionError,
        isLoading: competitionLoading,
        isSuccess: competitionIsSuccess
    } = useGetCompetitionsQuery();

    const {data: user} = useGetUserByIdQuery('me');
    const isStaff = !!user?.is_staff;

    return (
        <>
            <div className="overflow-x-auto mx-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
                <div className="flex items-center justify-between gap-2">
                    <div className="mr-auto"></div>

                    <div className="bg-white dark:bg-gray-700 rounded-full shadow-sm w-max mx-auto max-w-[calc(100vw-7rem)] overflow-x-auto">
                        <nav className="flex space-x-1 sm:space-x-4 text-sm font-medium text-gray-600 whitespace-nowrap px-2">
                            <Link to='/dashboard'
                                  className={"px-4 py-2 rounded-full transition-colors " + ((page === 'my' ? "bg-sky-800 text-white" : "hover:text-light-blue dark:text-white"))}>My
                                Space
                            </Link>
                            {(competitionIsSuccess) ? Object.entries(competitions).slice(0, 3).map(([_, competition], i) => (
                                <Link key={"key" + competition.id} to={`/competition/${competition.id}`}
                                      className={"hidden sm:inline-block px-4 py-2 rounded-full transition-colors " + ((page === `${competition.id}` ? "bg-sky-800 text-white" : "hover:text-light-blue dark:text-white"))}>
                                    {competition.name}
                                </Link>
                            )) : null}
                            <div onClick={() => setShowEditCompetitionModal(true)}
                                 className="px-4 py-2 rounded-full transition-colors hover:text-light-blue dark:text-white cursor-pointer">+
                                Create Competition
                            </div>
                            {isStaff && (
                                <Link to="/admin/site-settings"
                                      className={"hidden sm:inline-flex items-center gap-1 px-4 py-2 rounded-full transition-colors " + ((page === 'admin' ? "bg-sky-800 text-white" : "hover:text-light-blue dark:text-white"))}>
                                    <Shield className="h-3 w-3"/> Admin
                                </Link>
                            )}
                        </nav>
                    </div>
                    <div className="flex pl-2 space-x-2 ml-auto">
                        <Link to={'/logout'} aria-label="Logout"
                              className="bg-white dark:bg-gray-700 rounded-full shadow-sm w-max p-2 min-h-[44px] min-w-[44px] flex items-center justify-center">
                            <LogOut className="w-5 h-5"/>
                        </Link>
                        <button onClick={() => setShowSupportModal(true)} aria-label="Help"
                                className="bg-white dark:bg-gray-700 rounded-full shadow-sm w-max p-2 min-h-[44px] min-w-[44px]">
                            <BadgeHelp className="w-5 h-5"/>
                        </button>
                    </div>
                </div>
            </div>
                {(showEditCompetitionModal) && <CompetitionForm setModalState={setShowEditCompetitionModal} id={showEditCompetitionModal}/>}
                {(showSupportModal) && <SupportModal setModalState={setShowSupportModal}/>}
            </>
            );
            }
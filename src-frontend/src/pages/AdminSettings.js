import React, {useState} from "react";
import {Settings} from "lucide-react";
import {SectionLoader} from "../utils/loaders";
import {BoxSection, PageWrapper} from "../utils/miscellaneous";
import SiteSettingsForm from "../forms/siteSettingsForm";
import {useGetUserByIdQuery} from "../utils/reducers/usersSlice";


export default function AdminSettings() {
    const {data: user, isLoading: userLoading} = useGetUserByIdQuery('me');
    const [showEditModal, setShowEditModal] = useState(false);

    if (userLoading) {
        return (
            <PageWrapper>
                <div className="container mx-auto p-4">
                    <SectionLoader height={"h-48"}/>
                </div>
            </PageWrapper>
        );
    }

    if (!user?.is_staff) {
        return (
            <PageWrapper>
                <div className="container mx-auto p-4">
                    <BoxSection>
                        <div className="text-center text-gray-600 dark:text-gray-300 py-12">
                            <Settings className="h-12 w-12 mx-auto mb-4 text-gray-400"/>
                            <h2 className="text-2xl font-semibold mb-2">Admin only</h2>
                            <p>This page is restricted to site administrators.</p>
                        </div>
                    </BoxSection>
                </div>
            </PageWrapper>
        );
    }

    return (
        <PageWrapper>
            <div className="container mx-auto p-4">
                <BoxSection additionalClasses="mb-4">
                    <div className="flex flex-col items-center justify-between sm:flex-row sm:items-center sm:gap-6 sm:py-4">
                        <div className="space-y-1 pl-0 sm:pl-6 pb-3 sm:pb-0 text-center sm:text-left">
                            <p className="text-2xl font-display uppercase tracking-wide">Site Settings</p>
                            <p className="font-small text-gray-500">
                                LLM provider configuration used by the AI Drill Instructor and the weekly email.
                            </p>
                        </div>
                        <div className="p-3">
                            <button
                                onClick={() => setShowEditModal(true)}
                                className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 font-bold text-sm flex items-center gap-2 transition"
                            >
                                <Settings className="h-4 w-4"/> Edit Settings
                            </button>
                        </div>
                    </div>
                </BoxSection>

                <BoxSection>
                    <div className="text-sm text-gray-600 dark:text-gray-400 p-4 space-y-2">
                        <p>
                            As the first registered user you have admin access. You can also manage the same
                            settings from the <a className="text-volt-600 dark:text-volt-400 underline" href="/admin/site_settings/sitesettings/1/change/" target="_blank" rel="noopener noreferrer">Django admin</a>.
                        </p>
                        <p>
                            To promote other users to admin, run:
                        </p>
                        <pre className="bg-gray-100 dark:bg-gray-900 rounded p-3 text-xs overflow-x-auto">
                            <code>docker compose exec workoutchallenge python manage.py promotetostaff user@example.com</code>
                        </pre>
                    </div>
                </BoxSection>
            </div>

            {showEditModal && <SiteSettingsForm setModalState={setShowEditModal}/>}
        </PageWrapper>
    );
}
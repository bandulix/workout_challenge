import React, {useEffect, useState} from "react";
import {Modal} from "./basicComponents";
import {ChevronDown, ChevronUp, ExternalLink} from "lucide-react";

const SENTRY_DSN = window.RUNTIME_CONFIG?.REACT_APP_SENTRY_DSN;
const AccordionItem = ({title, content, link}) => {
    const [isOpen, setIsOpen] = useState(false);

    if (link) {
        return (
            <div className="border-b">
                <a
                    href={link}
                    target="_blank"
                    className="w-full flex justify-between items-center py-3 text-left font-medium text-gray-800 dark:text-gray-200 hover:underline"
                >
                    <span>{title}</span>
                    <ExternalLink className="w-4 h-4"/>
                </a>
            </div>
        );
    }

    return (
        <div className="border-b">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex justify-between items-center py-3 text-left font-medium text-gray-800 dark:text-gray-200 hover:underline"
            >
                <span>{title}</span>
                {isOpen ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
            </button>
            {isOpen && (
                <div className="pb-4 text-gray-600 dark:text-gray-400">
                    <div dangerouslySetInnerHTML={{ __html: content }} />
                </div>
            )}
        </div>
    );
};

function AccordionMenu() {
    const items = [
        {title: "How are points calculated?", content: "Each 1% towards an Activity Goal earns you 1 point. E.g. if the workout goal is 100 minutes, working out 50 minutes earns you 50 points. However, there can be upper and lower limits above/below which you don't earn any points (activities that were capped/floored are indicated with an *asterix). Hover with the mouse above a goal to see its limits or above the workout's asterix for more details."},
        {title: "My workouts don't show up in the Strava App!", content: "This ia a Strava app automatic import error (e.g. due to no internet connection when finishing a workout). Go to the Strava App -> You -> Settings -> Manage an app or device -> e.g. for an Apple Watch click on the 'Service: Health' App -> click 'Add' next to the workout that wasn't automatically imported."},
        {title: "See Source Code", link: "https://github.com/vanalmsick/workout_challenge"},
        {title: "Suggest a Feature", link: "https://github.com/vanalmsick/workout_challenge/discussions/categories/ideas"},
        {title: "Report a Bug", link: "https://github.com/vanalmsick/workout_challenge/issues"},
        {title: "Help developing", link: "https://github.com/vanalmsick/workout_challenge#do-you-want-to-help--contribute"},
        {title: "What data is saved and how is it handled?", content: "No data is sold/shared to/with anyone. If you delete your account all data is unrecoverably deleted. There might be backups containing your user data for a few more weeks until the retention period is exceeded. " + ((SENTRY_DSN !== undefined && SENTRY_DSN !== null && SENTRY_DSN !== '') ? "<a class='text-blue-500 hover:underline' target='_blank' href='https://sentry.io/'>Sentry.io</a> error and performance monitoring is enabled. In line with EU GDPR, if errors occur these are reported anonymized (no 'Personal-Identifiable-Information') to the administrator on top of some basic statics like loading speed of approx. 25% of sessions to detect malfunctions. Please see Sentry.io's data privacy policy. " : "") + "No user statistics or other analytics are collected by the website itself. The data you see when using the app is the data saved (e.g. personal profile, workout data, competition signups, points)."},
        {title: "Credits", content: "This is an Open Source project under the SSPL v1.0 license on <a class='text-blue-500 hover:underline' target='_blank' href='https://github.com/vanalmsick/workout_challenge'>github.com/vanalmsick/workout_challenge</a>. See <a class='text-blue-500 hover:underline' target='_blank' href='/credits.txt'>here for stock image credits</a>."},
    ];

    return (
        <div className="max-w-xl mx-auto divide-y divide-gray-300">
            {items.map((item, index) => (
                <AccordionItem key={index} {...item} />
            ))}
            <div className="border-b py-4">
                <div align="center">
                    <p className="mb-1.5">If you like <b>Workout Challenge</b>, consider giving it a <b>star on Github</b> ⭐!</p>
                    <p className="mb-3">Made with ❤️ in London</p>
                    <a href='https://ko-fi.com/vanalmsick' target='_blank'><img height='36' style={{'border': '0px', 'height': '36px'}} src='https://storage.ko-fi.com/cdn/kofi1.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>
                </div>
            </div>
        </div>
    );
}


export default function SupportModal({setModalState}) {

    return (
        <Modal title="Information & Help" landscape={false} setShowModal={setModalState} isLoading={false}>
            <AccordionMenu/>
        </Modal>
    )
}
import React, {useState} from "react";
import {Modal} from "./basicComponents";
import {ChevronDown, ExternalLink} from "lucide-react";

const SENTRY_DSN = window.RUNTIME_CONFIG?.REACT_APP_SENTRY_DSN;

const AccordionItem = ({title, content, link}) => {
    const [isOpen, setIsOpen] = useState(false);

    const row = "w-full flex justify-between items-center gap-3 px-3 py-3 text-left font-semibold text-sm min-h-[48px]";

    if (link) {
        return (
            <a href={link} target="_blank" rel="noopener noreferrer"
               className={row + " rounded-2xl hover:bg-gray-100 dark:hover:bg-ink-800"}>
                <span>{title}</span>
                <ExternalLink className="w-4 h-4 text-gray-400 shrink-0"/>
            </a>
        );
    }

    return (
        <div className="rounded-2xl hover:bg-gray-100 dark:hover:bg-ink-800">
            <button onClick={() => setIsOpen(!isOpen)} className={row}>
                <span>{title}</span>
                <ChevronDown className={"w-4 h-4 text-gray-400 shrink-0 transition-transform " + (isOpen ? "rotate-180" : "")}/>
            </button>
            {isOpen && (
                <div className="px-3 pb-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {content}
                </div>
            )}
        </div>
    );
};

function AccordionMenu() {
    const items = [
        {title: "How are points calculated?", content: "Each 1% towards an Activity Goal earns you 1 point. E.g. if the workout goal is 100 minutes, working out 50 minutes earns you 50 points. However, there can be upper and lower limits above/below which you don't earn any points (activities that were capped/floored are indicated with an *asterix). Hover with the mouse above a goal to see its limits or above the workout's asterix for more details."},
        {title: "My workouts don't show up in the Strava App!", content: "This ia a Strava app automatic import error (e.g. due to no internet connection when finishing a workout). Go to the Strava App -> You -> Settings -> Manage an app or device -> e.g. for an Apple Watch click on the 'Service: Health' App -> click 'Add' next to the workout that wasn't automatically imported."},
        {title: "See Source Code", link: "https://github.com/bandulix/workout_challenge"},
        {title: "Suggest a Feature", link: "https://github.com/bandulix/workout_challenge/discussions/categories/ideas"},
        {title: "Report a Bug", link: "https://github.com/bandulix/workout_challenge/issues"},
        {title: "Original project (upstream)", link: "https://github.com/vanalmsick/workout_challenge"},
        {title: "What data is saved and how is it handled?", content: (
            <>
                No data is sold/shared to/with anyone. If you delete your account all data is unrecoverably deleted. There might be backups containing your user data for a few more weeks until the retention period is exceeded.
                {SENTRY_DSN ? (
                    <> <a className="text-volt-700 dark:text-volt-300 hover:underline" target="_blank" rel="noopener noreferrer" href="https://sentry.io/">Sentry.io</a> error and performance monitoring is enabled. In line with EU GDPR, if errors occur these are reported anonymized (no Personal-Identifiable-Information) to the administrator, plus basic loading-speed stats on about 25% of sessions. Please see Sentry.io&apos;s data privacy policy.</>
                ) : null}
                {" "}No user statistics or other analytics are collected by the website itself. The data you see when using the app is the data saved (e.g. personal profile, workout data, competition signups, points).
            </>
        )},
        {title: "Credits", content: (
            <>
                Fork of <a className="text-volt-700 dark:text-volt-300 hover:underline" target="_blank" rel="noopener noreferrer" href="https://github.com/vanalmsick/workout_challenge">vanalmsick/workout_challenge</a> under the SSPL v1.0 license — see <a className="text-volt-700 dark:text-volt-300 hover:underline" target="_blank" rel="noopener noreferrer" href="https://github.com/bandulix/workout_challenge">github.com/bandulix/workout_challenge</a>. See <a className="text-volt-700 dark:text-volt-300 hover:underline" target="_blank" rel="noopener noreferrer" href="/credits.txt">here for stock image credits</a>.
            </>
        )},
    ];

    return (
        <div className="space-y-0.5">
            {items.map((item, index) => (
                <AccordionItem key={index} {...item} />
            ))}
            <div className="mt-3 rounded-2xl glass-inset px-4 py-3 text-center text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p><b className="font-display uppercase tracking-wide text-ink-950 dark:text-gray-200">Workout Challenge</b></p>
                <p>Fork of <a className="text-volt-700 dark:text-volt-300 hover:underline" target="_blank" rel="noopener noreferrer" href="https://github.com/vanalmsick/workout_challenge">vanalmsick/workout_challenge</a></p>
                <p>Original work © 2025 <a className="text-volt-700 dark:text-volt-300 hover:underline" target="_blank" rel="noopener noreferrer" href="https://github.com/vanalmsick">github.com/vanalmsick</a><br/>
                Fork modifications © 2026 <a className="text-volt-700 dark:text-volt-300 hover:underline" target="_blank" rel="noopener noreferrer" href="https://github.com/bandulix/workout_challenge">bandulix</a></p>
                <p>Licensed under the <a className="text-volt-700 dark:text-volt-300 hover:underline" target="_blank" rel="noopener noreferrer" href="https://github.com/bandulix/workout_challenge/blob/main/LICENSE">Server Side Public License v1 (SSPL)</a></p>
            </div>
        </div>
    );
}


export default function SupportModal({setModalState}) {
    return (
        <Modal title="Help & Support" landscape={false} setShowModal={setModalState} isLoading={false}>
            <AccordionMenu/>
        </Modal>
    );
}

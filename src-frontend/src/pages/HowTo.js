import {useEffect, useState} from 'react'
import {QRCodeSVG} from 'qrcode.react';
import {usersApi} from "../utils/reducers/usersSlice";
import {useDispatch} from "react-redux";
import {workoutsApi} from "../utils/reducers/workoutsSlice";
import {statsApi} from "../utils/reducers/statsSlice";


export function LinkStravaScreen({setModal}) {
    const [current, setCurrent] = useState(0)
    const domain = window.location.origin;
    const url = domain + '/strava/link/';

    const dispatch = useDispatch();

    function refreshWorkouts() {
        dispatch(workoutsApi.util.invalidateTags(['Workout']));
        dispatch(usersApi.util.invalidateTags(['User']));
        dispatch(statsApi.util.invalidateTags(['Stats']));
    }

    useEffect(() => {
        document.body.classList.add("body-no-scroll");
    }, [])

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center overflow-auto p-4">
            <div className="glass-card rounded-3xl p-8 max-w-2xl w-full text-center space-y-4 max-h-[100vh] overflow-y-auto">
                {
                    current === 0 ? (
                        <>
                            <h2 className="text-xl font-semibold">Link a service for automatic import</h2>
                            <p className="text-gray-600 dark:text-gray-400">Log workouts by hand, or connect
                                Strava, Garmin Connect, or Apple Health / Google Health Connect.
                                Only one source imports at a time — pick it in Settings.</p>
                            <img src="/how_to_strava_sync.png" alt=""/>
                            <p>We only store the metrics used for scoring:</p>
                            <ul>
                                <li>• Sport type</li>
                                <li>• Start time & duration</li>
                                <li>• Workout id from the provider</li>
                                <li>• Distance, kcal, steps when the provider sends them</li>
                                <li>––– That&apos;s it – nothing more! –––</li>
                            </ul>
                            <p className="text-gray-500 text-sm italic">Open Settings to link a provider. Strava
                                still uses this QR flow; Garmin and Health Connect link in Settings.</p>
                        </>
                    ) : (
                        <>
                            <h2 className="text-xl font-semibold">Connect Strava</h2>
                            <p className="text-gray-600 dark:text-gray-400">Scan the QR code with your phone or click
                                the link below to connect Strava. Garmin and Health Connect are linked from Settings.</p>
                            <div className="flex justify-center items-center">
                                <QRCodeSVG value={url} title={"QR code to link to Strava account"} size={200}
                                           level={"L"}/>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400">Or <a
                                className="text-volt-700 dark:text-volt-300 font-semibold hover:underline" href={url}
                                target="_blank" rel="noopener noreferrer">click this link</a></p>
                        </>
                    )
                }
                <div className="flex justify-between mt-6">
                    <button className="text-sm text-gray-500"
                            onClick={() => {
                                if (current === 0) {
                                    document.body.classList.remove("body-no-scroll");
                                    setModal(false); // Close the modal
                                } else {
                                    setCurrent(0); // Go to previous step
                                }
                            }}
                    >
                        {current === 0 ? 'Close without linking' : 'Back'}
                    </button>
                    <button className="bg-volt-400 text-ink-950 px-5 py-2.5 rounded-full text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt"
                            onClick={() => {
                                if (current === 1) {
                                    document.body.classList.remove("body-no-scroll");
                                    setModal(false); // Close the modal
                                    refreshWorkouts(); // refresh workouts in case Strava was linked on phone via QR code
                                } else {
                                    setCurrent(1); // Go to next step
                                }
                            }}
                    >
                        {current === 1 ? 'Close' : "Link Strava"}
                    </button>
                </div>
            </div>
        </div>
    )
}

import {useState} from 'react'
import {QRCodeSVG} from 'qrcode.react';
import {usersApi} from "../utils/reducers/usersSlice";
import {useDispatch} from "react-redux";
import {workoutsApi} from "../utils/reducers/workoutsSlice";
import {statsApi} from "../utils/reducers/statsSlice";
import {OverlaySheet} from "../forms/basicComponents";


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

    function close() {
        setModal(false);
    }

    return (
        <OverlaySheet title={current === 0 ? "Link a service" : "Connect Strava"} onClose={close}>
                {
                    current === 0 ? (
                        <div className="text-center space-y-4">
                            <p className="text-gray-600 dark:text-gray-400">Log workouts by hand, or connect
                                Strava, Garmin Connect, or Apple Health / Google Health Connect.
                                Only one source imports at a time — pick it in Settings.</p>
                            <img src="/how_to_strava_sync.png" alt="" className="mx-auto rounded-2xl"/>
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
                        </div>
                    ) : (
                        <div className="text-center space-y-4">
                            <p className="text-gray-600 dark:text-gray-400">Scan the QR code with your phone or click
                                the link below to connect Strava. Garmin and Health Connect are linked from Settings.</p>
                            <div className="flex justify-center items-center">
                                <QRCodeSVG value={url} title={"QR code to link to Strava account"} size={200}
                                           level={"L"}/>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400">Or <a
                                className="text-volt-700 dark:text-volt-300 font-semibold hover:underline" href={url}
                                target="_blank" rel="noopener noreferrer">click this link</a></p>
                        </div>
                    )
                }
                <div className="flex justify-between">
                    <button type="button" className="text-sm text-gray-500 min-h-[44px]"
                            onClick={() => {
                                if (current === 0) close();
                                else setCurrent(0);
                            }}
                    >
                        {current === 0 ? 'Close without linking' : 'Back'}
                    </button>
                    <button type="button" className="bg-volt-400 text-ink-950 px-5 py-2.5 rounded-full text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt"
                            onClick={() => {
                                if (current === 1) {
                                    close();
                                    refreshWorkouts();
                                } else {
                                    setCurrent(1);
                                }
                            }}
                    >
                        {current === 1 ? 'Close' : "Link Strava"}
                    </button>
                </div>
        </OverlaySheet>
    )
}

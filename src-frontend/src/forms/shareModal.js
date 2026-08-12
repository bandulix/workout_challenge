import React from "react";
import {Modal} from "./basicComponents";
import {getServerUrl, isNativeApp} from "../utils/serverUrl";

export default function CompetitionInviteModal({competition, setModalState}) {
    // In the Android app window.location.origin is the WebView's own
    // https://localhost - a localhost invite link is useless on anyone
    // else's phone. The real server address lives in the server-url
    // store (entered once at first start / baked per-deployment).
    const hostUrl = isNativeApp() ? getServerUrl() : window.location.origin;
    const url = hostUrl + '?join=' + competition.join_code;

    return (
        <Modal title="Invite Friends" landscape={false} setShowModal={setModalState} isLoading={false}>
            <div className="text-gray-800 dark:text-gray-200 leading-relaxed">
                <p><b>Link to join:</b> {url}</p>
                <p><b>Join code:</b> {competition.join_code}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Anyone opening this link can register right away - no invite token needed.</p>
            </div>
            <div className="relative bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300 rounded-xl p-4">
                <button
                    onClick={() => navigator.clipboard.writeText(document.getElementById('code-block').innerText)}
                    className="absolute top-2 right-2 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 px-2 py-1 rounded">
                    Copy
                </button>
                <pre id="code-block" className="overflow-x-auto whitespace-pre-wrap text-sm">
                    <code>Hi, I am taking part in the "{competition.name}" competition.<br/>It would be even more fun if you'd join, too.<br/>Here is the link to join: {url}</code>
                </pre>
            </div>
        </Modal>
    )
}
import React, {useEffect, useState} from "react";
import {Bell, BellOff, BellRing, Share, PlusSquare, Download, Smartphone} from "lucide-react";
import {useGetPushStatusQuery, useSubscribePushMutation, useUnsubscribePushMutation, useTestPushMutation} from "../utils/reducers/pushSlice";
import {subscribeToPush, unsubscribeFromPush, promptInstall} from "../index";
import usePollingInterval from "../utils/usePollingInterval";
import {notice} from "../utils/dialogs";

// Platform-aware push opt-in card. Handles the iOS "install to home
// screen first" dance, the Android/desktop native install prompt, and
// the actual subscribe / unsubscribe flow against /api/push/*.

function detectPlatform() {
    const ua = window.navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches
        || window.matchMedia?.("(display-mode: fullscreen)").matches
        || window.navigator.standalone === true;
    const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    return {isIOS, isAndroid, standalone, pushSupported};
}

function PushOptInCard({compact = false}) {
    const [platform, setPlatform] = useState(detectPlatform);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const pollFast = usePollingInterval(60000);
    const {data: status, refetch} = useGetPushStatusQuery(undefined, {pollingInterval: pollFast});
    const [subscribePush] = useSubscribePushMutation();
    const [unsubscribePush] = useUnsubscribePushMutation();
    const [testPush] = useTestPushMutation();

    useEffect(() => {
        const update = () => setPlatform(detectPlatform());
        window.addEventListener("pwa-install-available", update);
        window.addEventListener("pwa-installed", update);
        return () => {
            window.removeEventListener("pwa-install-available", update);
            window.removeEventListener("pwa-installed", update);
        };
    }, []);

    if (!platform.pushSupported) return null;

    const subscribed = Boolean(status?.subscribed);
    const permission = typeof Notification !== "undefined" ? Notification.permission : "default";

    async function handleSubscribe() {
        setBusy(true);
        setError(null);
        try {
            const sub = await subscribeToPush(status?.vapid_public_key);
            const json = sub.toJSON();
            await subscribePush({
                endpoint: json.endpoint,
                p256dh: json.keys.p256dh,
                auth: json.keys.auth,
                user_agent: navigator.userAgent.slice(0, 300),
            }).unwrap();
            await refetch();
        } catch (err) {
            setError(err?.data?.detail || err?.message || "Could not enable notifications.");
        } finally {
            setBusy(false);
        }
    }

    async function handleUnsubscribe() {
        setBusy(true);
        setError(null);
        try {
            const sub = await unsubscribeFromPush();
            // Always clear server-side rows too: the browser may have
            // silently lost its local subscription (FCM endpoint
            // rotation, service-worker reset, site-data cleanup) while
            // stale rows linger on the server - without this the status
            // stays "on" forever and pushes route to dead endpoints.
            // No endpoint -> the backend removes all of the user's rows.
            await unsubscribePush(sub?.endpoint ? {endpoint: sub.endpoint} : {}).unwrap();
            await refetch();
        } catch (err) {
            setError(err?.data?.detail || err?.message || "Could not disable notifications.");
        } finally {
            setBusy(false);
        }
    }

    async function handleTestPing() {
        setBusy(true);
        setError(null);
        try {
            const res = await testPush().unwrap();
            const results = res?.results || [];
            const failed = results.filter((r) => !r.ok);
            if (results.length === 0) {
                await notice("No subscription is stored on the server for this account. Turn pings off and on again, then retry.");
            } else if (failed.length > 0) {
                const f = failed[0];
                await notice(`The server could not deliver the ping: HTTP ${f.status || "?"} - ${f.error || "unknown error"}`);
            } else {
                await notice(`Ping sent to ${results.length} device(s). If nothing shows up, the block is on the device (notification permission / battery optimization / Brave push setting).`);
            }
        } catch (err) {
            await notice("Test ping failed: " + JSON.stringify(err?.data || err?.message));
        } finally {
            setBusy(false);
        }
    }

    // iOS requires the PWA to be installed before push can be enabled.
    if (platform.isIOS && !platform.standalone) {
        return (
            <div className="rounded-3xl border border-gray-300 bg-white text-ink-950 dark:border-ink-700/60 dark:bg-ink-850 dark:text-white p-5">
                <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-2xl bg-volt-400/20 dark:bg-volt-400/15 flex items-center justify-center">
                        <Smartphone className="h-5 w-5 text-volt-700 dark:text-volt-400"/>
                    </div>
                    <h3 className="font-display text-sm uppercase tracking-wider">Coach on your lock screen</h3>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    On iPhone, notifications work from the installed app. It takes 10 seconds:
                </p>
                <ol className="mt-3 space-y-2 text-sm text-gray-200">
                    <li className="flex items-center gap-2">
                        <span className="text-volt-700 dark:text-volt-400 font-bold">1.</span> Tap <Share className="inline h-4 w-4 -mt-0.5"/> <b>Share</b> in Safari
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="text-volt-700 dark:text-volt-400 font-bold">2.</span> <PlusSquare className="inline h-4 w-4 -mt-0.5"/> <b>Add to Home Screen</b>
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="text-volt-700 dark:text-volt-400 font-bold">3.</span> Open the app from your home screen
                    </li>
                </ol>
            </div>
        );
    }

    return (
        <div className="rounded-3xl border border-gray-300 bg-white text-ink-950 dark:border-ink-700/60 dark:bg-ink-850 dark:text-white p-5">
            <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-2xl bg-volt-400/20 dark:bg-volt-400/15 flex items-center justify-center">
                    {subscribed ? <BellRing className="h-5 w-5 text-volt-700 dark:text-volt-400"/> : <Bell className="h-5 w-5 text-volt-700 dark:text-volt-400"/>}
                </div>
                <div>
                    <h3 className="font-display text-sm uppercase tracking-wider">
                        {subscribed ? "Coach pings are on" : "Coach pings"}
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                        {subscribed
                            ? `Active on ${status?.count || 1} device${(status?.count || 1) > 1 ? "s" : ""}`
                            : "Get the Drill Instructor on your lock screen"}
                    </p>
                </div>
            </div>

            {!platform.standalone && (platform.isAndroid || window.deferredInstallPrompt) && (
                <button
                    onClick={() => promptInstall()}
                    className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl border border-volt-500/50 text-volt-800 dark:border-volt-400/40 dark:text-volt-300 py-2.5 text-sm font-semibold hover:bg-volt-400/10 transition"
                >
                    <Download className="h-4 w-4"/> Install the app first for the full experience
                </button>
            )}

            {permission === "denied" ? (
                <p className="mt-3 text-sm text-amber-300">
                    Notifications are blocked in your browser settings. Allow them for this site, then come back.
                </p>
            ) : subscribed ? (
                <>
                    <button
                        onClick={handleUnsubscribe}
                        disabled={busy}
                        className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl bg-gray-200 text-ink-950 dark:bg-ink-700 dark:text-gray-200 py-2.5 text-sm font-semibold hover:bg-gray-300 dark:hover:bg-ink-600 transition disabled:opacity-50"
                    >
                        <BellOff className="h-4 w-4"/> {busy ? "Turning off…" : "Turn off coach pings"}
                    </button>
                    <button
                        onClick={handleTestPing}
                        disabled={busy}
                        className="mt-2 w-full flex items-center justify-center gap-2 rounded-2xl border border-volt-500/50 text-volt-800 dark:border-volt-400/40 dark:text-volt-300 py-2 text-xs font-semibold hover:bg-volt-400/10 transition disabled:opacity-50"
                    >
                        <BellRing className="h-3.5 w-3.5"/> Send test ping
                    </button>
                </>
            ) : (
                <button
                    onClick={handleSubscribe}
                    disabled={busy}
                    className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl bg-volt-400 text-ink-950 py-3 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt disabled:opacity-50"
                >
                    <Bell className="h-4 w-4"/> {busy ? "Enabling…" : "Enable coach pings"}
                </button>
            )}

            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            {!compact && platform.isIOS && (
                <p className="mt-3 text-xs text-gray-500">Requires iOS 16.4 or newer.</p>
            )}
        </div>
    );
}

export default PushOptInCard;

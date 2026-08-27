import React from 'react';
import ReactDOM from 'react-dom/client';
import {Provider} from 'react-redux';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import store from './utils/store';
import {ErrorBoundary} from './utils/miscellaneous';
import {isNativeApp} from './utils/platform';


// Optional Sentry monitoring - dynamically imported so the (heavy)
// Sentry bundles are only fetched when a DSN is actually configured.
const SENTRY_DSN = window.RUNTIME_CONFIG?.REACT_APP_SENTRY_DSN;
if (SENTRY_DSN !== undefined && SENTRY_DSN !== null && SENTRY_DSN !== '') {
    console.log('Sentry error monitoring is enabled.');
    import('@sentry/react').then((Sentry) => {
        Sentry.init({
            dsn: SENTRY_DSN,
            environment: "frontend",
            integrations: [
                Sentry.browserTracingIntegration(),
                Sentry.browserProfilingIntegration(),
                Sentry.replayIntegration({
                    maskAllText: true,
                    blockAllMedia: true,
                }),
                Sentry.feedbackIntegration({
                    colorScheme: "dark",
                }),
            ],
            sendDefaultPii: false,
            tracesSampleRate: 0.25,
            replaysSessionSampleRate: 0.05,
            replaysOnErrorSampleRate: 1.0,
        });
    }).catch((err) => console.warn('Sentry failed to load:', err));
}


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <Provider store={store}>
            {/* Render-time errors anywhere in the tree land here instead
                of leaving a dead white screen - with a reload button. */}
            <ErrorBoundary>
                <App/>
            </ErrorBoundary>
        </Provider>
    </React.StrictMode>
);


// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();


// ---- Service worker registration --------------------------------------
// PWA only. Capacitor's Android WebView origin is https://localhost with
// assets bundled in the APK — a service worker there fights APK updates
// (it keeps serving the previous shell) and is unnecessary for offline.
// Ionic/Capacitor guidance: skip SW on native; keep it for the browser PWA.
if (isNativeApp() && 'serviceWorker' in navigator) {
    const FLAG = 'wc-sw-cleared';
    navigator.serviceWorker.getRegistrations().then(async (regs) => {
        const hadWorker = regs.length > 0 || Boolean(navigator.serviceWorker.controller);
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        }
        // One reload so this session is no longer controlled by the old
        // worker (unregister does not drop the current controller).
        if (hadWorker && !sessionStorage.getItem(FLAG)) {
            sessionStorage.setItem(FLAG, '1');
            window.location.reload();
        }
    }).catch(() => {});
} else if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(
            (reg) => {
                console.log('Service worker registered with scope:', reg.scope);
                // Long-open tabs: check for an updated worker periodically
                // and whenever the tab returns to the foreground, so new
                // deployments reach users without a manual refresh.
                setInterval(() => reg.update(), 60 * 60 * 1000);
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') reg.update();
                });
            },
            (err) => {
                console.warn('Service worker registration failed:', err);
            }
        );

        // The new worker activates immediately (skipWaiting + claim) and
        // everything it serves is network-first, so swapping to it is
        // safe: reload once to run the fresh build. The hadController
        // guard skips the very first install (no reload needed there).
        const hadController = !!navigator.serviceWorker.controller;
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!hadController || refreshing) return;
            refreshing = true;
            window.location.reload();
        });
    });
}


// ---- Stale-chunk rescue -------------------------------------------------
// If a lazy-loaded bundle can't be fetched (e.g. a redeploy replaced the
// build while this tab was open and the cache missed), reload once to
// pick up the current build instead of leaving a broken page behind.
function isChunkLoadError(message) {
    return /Loading chunk \d+ failed|dynamically imported module/i.test(String(message || ''));
}

function reloadForFreshAssets() {
    // Guard against reload loops: at most one auto-reload per minute.
    const last = Number(sessionStorage.getItem('wc-chunk-reload') || 0);
    if (Date.now() - last < 60 * 1000) return;
    sessionStorage.setItem('wc-chunk-reload', String(Date.now()));
    window.location.reload();
}

window.addEventListener('error', (event) => {
    if (isChunkLoadError(event.message)) reloadForFreshAssets();
});
window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason?.message || event.reason)) reloadForFreshAssets();
});


// ---- Install prompt capture ------------------------------------------
// Chrome/Android fires `beforeinstallprompt`; we stash it globally so the
// InstallBanner / Coach page can trigger the native install dialog later.
window.deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredInstallPrompt = e;
    window.dispatchEvent(new Event('pwa-install-available'));
});
window.addEventListener('appinstalled', () => {
    window.deferredInstallPrompt = null;
    window.dispatchEvent(new Event('pwa-installed'));
});

export async function promptInstall() {
    const promptEvent = window.deferredInstallPrompt;
    if (!promptEvent) return false;
    promptEvent.prompt();
    const {outcome} = await promptEvent.userChoice;
    window.deferredInstallPrompt = null;
    return outcome === 'accepted';
}


// ---- Push notification subscription helpers ---------------------------
// The Drill Instructor can send a browser push when it generates a
// message. The user opts in from the Coach page / Site Settings; the
// resulting PushSubscription is POSTed to /api/push/subscribe/.

export async function subscribeToPush(vapidKeyOverride) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error("Push notifications are not supported in this browser.");
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error("Notification permission denied.");
    }
    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
        const vapidKey = vapidKeyOverride || window.RUNTIME_CONFIG?.REACT_APP_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
            throw new Error("Push is not configured on this server (missing VAPID key).");
        }
        subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
    }
    return subscription;
}

export async function unsubscribeFromPush() {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    return subscription;
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

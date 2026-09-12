import React, {Suspense, lazy, useEffect} from "react";
import {BrowserRouter as Router, Routes, Route, useLocation, useNavigate} from "react-router-dom";
import {rememberPath} from "./utils/lastPath";
import {rememberLastCompetition} from "./utils/challenge";
import {useDarkTheme} from "./utils/theme";
import {useApkGate} from "./utils/apkUpdate";
import {
    WelcomePage,
    RegisterPage,
    LogInPage,
    ResetPasswordPage,
    SetNewPasswordPage,
    VerifyEmailPage,
    NotFound,
    LogoutPage
} from "./pages/Public";
import BottomNav from "./utils/bottomNav";
import AppBackdrop from "./components/AppBackdrop";
import WhatsNew from "./components/WhatsNew";

import VerifyEmailBanner from "./components/VerifyEmailBanner";
import DialogHost from "./components/DialogHost";
import ForceUpdateScreen, {ForceUpdateChecking} from "./components/ForceUpdateScreen";
import {InitStravaLink, ReturnStravaLink} from "./pages/StravaLink";
import {installSfxUnlock} from "./utils/sfx";
import {installMidiUnlock} from "./utils/midiBed";
import CoachMidiBed from "./components/CoachMidiBed";

// Lazy-loaded heavy pages - keeps the initial bundle small on mobile.
const MySpace = lazy(() => import("./pages/MySpace"));
const Competition = lazy(() => import("./pages/Competition"));
const Coach = lazy(() => import("./pages/Coach"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));


function RememberPath() {
    const location = useLocation();
    useEffect(() => {
        rememberPath(location.pathname, location.search);
        rememberLastCompetition(location.pathname);
    }, [location.pathname, location.search]);
    return null;
}


function App() {
    useDarkTheme();
    useEffect(() => {
        const stopSfx = installSfxUnlock();
        const stopMidi = installMidiUnlock();
        return () => {
            if (typeof stopSfx === "function") stopSfx();
            if (typeof stopMidi === "function") stopMidi();
        };
    }, []);
    return (
        <Router>
            <AppShell/>
        </Router>
    );
}


function DeepLinkListener() {
    const navigate = useNavigate();
    useEffect(() => {
        function go(url) {
            if (typeof url === "string" && url.startsWith("/")) navigate(url);
        }
        function onOpen(e) {
            go(e.detail);
        }
        function onMessage(e) {
            const data = e.data;
            if (data && data.type === "wc-open") go(data.url);
        }
        window.addEventListener("wc-open", onOpen);
        navigator.serviceWorker?.addEventListener?.("message", onMessage);
        let clickHandle = null;
        import("./utils/platform").then(({isNativeApp}) => {
            if (!isNativeApp()) return;
            import("@capacitor/local-notifications").then(({LocalNotifications}) => {
                LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
                    go(action?.notification?.extra?.url);
                }).then((h) => { clickHandle = h; }).catch(() => {});
            }).catch(() => {});
        }).catch(() => {});
        return () => {
            window.removeEventListener("wc-open", onOpen);
            navigator.serviceWorker?.removeEventListener?.("message", onMessage);
            try { clickHandle && clickHandle.remove && clickHandle.remove(); } catch (err) { /* ignore */ }
        };
    }, [navigate]);
    return null;
}

function AppShell() {
    const {status, update} = useApkGate();

    // Outdated APK: do not mount routes, the dock, or any live queries.
    // Those are what CrowdSec sees as a crawl, and they are the app
    // this screen is supposed to hide.
    if (status === "checking") {
        return (
            <>
                <DeepLinkListener/>
                <AppBackdrop forceCinematic/>
                <ForceUpdateChecking/>
            </>
        );
    }
    if (status === "outdated") {
        return (
            <>
                <DeepLinkListener/>
                <AppBackdrop forceCinematic/>
                <ForceUpdateScreen update={update}/>
            </>
        );
    }

    return (
        <>
            <RememberPath/>
            <DeepLinkListener/>
            <AppBackdrop/>
            <div className="relative z-10">
            <Routes>
                <Route path="/" element={<WelcomePage />} />
                <Route path="signup" element={<RegisterPage />} />
                <Route path="login" element={<LogInPage />} />
                <Route path="logout" element={<LogoutPage />} />
                <Route path="password" element={<ResetPasswordPage />} />
                <Route path="password/reset/:id/:token" element={<SetNewPasswordPage />} />
                <Route path="email/verify/:id/:token" element={<VerifyEmailPage />} />

                <Route path="dashboard" element={
                    <Suspense fallback={null}><MySpace/></Suspense>
                } />
                <Route path="competition/:id" element={
                    <Suspense fallback={null}><Competition/></Suspense>
                } />
                <Route path="coach" element={
                    <Suspense fallback={null}><Coach/></Suspense>
                } />

                <Route path="admin/site-settings" element={
                    <Suspense fallback={null}><AdminSettings/></Suspense>
                } />

                <Route path="strava/link" element={<InitStravaLink />} />
                <Route path="strava/return" element={<ReturnStravaLink />} />

                {/* Add the catch-all route last */}
                <Route path="*" element={<NotFound />} />
            </Routes>

            <BottomNav/>
            <CoachMidiBed/>
            <DialogHost/>
            {/* Release popup: changelog once per release. Web can reload;
                the APK already passed the force-update gate, so no download. */}
            <WhatsNew/>
            <VerifyEmailBanner/>
            </div>
        </>
    );
}



export default App;

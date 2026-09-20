import React, {Suspense, lazy, useEffect} from "react";
import {BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate} from "react-router-dom";
import {BeatLoader} from "react-spinners";
import {rememberPath} from "./utils/lastPath";
import {rememberLastCompetition} from "./utils/challenge";
import {useDarkTheme} from "./utils/theme";
import {useApkGate} from "./utils/apkUpdate";
import {getAccessToken, hasAuthMarker} from "./utils/authTokens";
import {sanitizeRedirect} from "./utils/authClient";
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
import ToastHost from "./components/ToastHost";
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


// Client-side gate for protected pages: without it a logged-out visit
// paints the page's error box until the API layer's 401 redirect fires
// - a terrible first impression. Send them to /login first (with the
// destination attached); the login page's refresh-token race brings
// still-authenticated users straight through.
function RequireAuth({children}) {
    const location = useLocation();
    if (!hasAuthMarker() && !getAccessToken()) {
        const dest = sanitizeRedirect(location.pathname + location.search) || "/coach";
        return <Navigate to={`/login?redirect=${encodeURIComponent(dest)}`} replace/>;
    }
    return children;
}


// Lazy pages used to render `fallback={null}` - a blank screen over the
// backdrop on every cold navigation.
function RouteFallback() {
    return (
        <div className="flex items-center justify-center min-h-[60vh]" role="status" aria-label="Loading page">
            <BeatLoader color="#d7ff3e"/>
        </div>
    );
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
                    <RequireAuth><Suspense fallback={<RouteFallback/>}><MySpace/></Suspense></RequireAuth>
                } />
                <Route path="competition/:id" element={
                    <RequireAuth><Suspense fallback={<RouteFallback/>}><Competition/></Suspense></RequireAuth>
                } />
                <Route path="coach" element={
                    <RequireAuth><Suspense fallback={<RouteFallback/>}><Coach/></Suspense></RequireAuth>
                } />

                <Route path="admin/site-settings" element={
                    <RequireAuth><Suspense fallback={<RouteFallback/>}><AdminSettings/></Suspense></RequireAuth>
                } />

                <Route path="strava/link" element={<InitStravaLink />} />
                <Route path="strava/return" element={<ReturnStravaLink />} />

                {/* Add the catch-all route last */}
                <Route path="*" element={<NotFound />} />
            </Routes>

            <BottomNav/>
            <CoachMidiBed/>
            <DialogHost/>
            <ToastHost/>
            {/* Release popup: changelog once per release. Web can reload;
                the APK already passed the force-update gate, so no download. */}
            <WhatsNew/>
            <VerifyEmailBanner/>
            </div>
        </>
    );
}



export default App;

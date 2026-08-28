import React, {Suspense, lazy, useEffect} from "react";
import {BrowserRouter as Router, Routes, Route, useLocation} from "react-router-dom";
import {rememberPath} from "./utils/lastPath";
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
import EchoArtNudge from "./components/EchoArtNudge";
import VerifyEmailBanner from "./components/VerifyEmailBanner";
import DialogHost from "./components/DialogHost";
import ForceUpdateScreen, {ForceUpdateChecking} from "./components/ForceUpdateScreen";
import {InitStravaLink, ReturnStravaLink} from "./pages/StravaLink";

// Lazy-loaded heavy pages - keeps the initial bundle small on mobile.
const MySpace = lazy(() => import("./pages/MySpace"));
const Competition = lazy(() => import("./pages/Competition"));
const Coach = lazy(() => import("./pages/Coach"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));


function RememberPath() {
    const location = useLocation();
    useEffect(() => {
        rememberPath(location.pathname, location.search);
    }, [location.pathname, location.search]);
    return null;
}


function App() {
    useDarkTheme();
    return (
        <Router>
            <AppShell/>
        </Router>
    );
}


function AppShell() {
    const {status, update} = useApkGate();

    // Outdated APK: do not mount routes, the dock, or any live queries.
    // Those are what CrowdSec sees as a crawl, and they are the app
    // this screen is supposed to hide.
    if (status === "checking") {
        return (
            <>
                <AppBackdrop forceCinematic/>
                <ForceUpdateChecking/>
            </>
        );
    }
    if (status === "outdated") {
        return (
            <>
                <AppBackdrop forceCinematic/>
                <ForceUpdateScreen update={update}/>
            </>
        );
    }

    return (
        <>
            <RememberPath/>
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
            <DialogHost/>
            {/* Release popup: one changelog + reload prompt per release. */}
            <WhatsNew/>
            <EchoArtNudge/>
            <VerifyEmailBanner/>
            </div>
        </>
    );
}



export default App;

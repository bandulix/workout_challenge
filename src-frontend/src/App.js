import React, {Suspense, lazy} from "react";
import './App.css';


import {BrowserRouter as Router, Routes, Route} from "react-router-dom";
import {
    WelcomePage,
    RegisterPage,
    LogInPage,
    ResetPasswordPage,
    SetNewPasswordPage,
    NotFound,
    LogoutPage
} from "./pages/Public";
import BottomNav from "./utils/bottomNav";
import WhatsNew from "./components/WhatsNew";
import {InitStravaLink, ReturnStravaLink} from "./pages/StravaLink";

// Lazy-loaded heavy pages - keeps the initial bundle small on mobile.
const MySpace = lazy(() => import("./pages/MySpace"));
const Competition = lazy(() => import("./pages/Competition"));
const Coach = lazy(() => import("./pages/Coach"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));


function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<WelcomePage />} />
                <Route path="signup" element={<RegisterPage />} />
                <Route path="login" element={<LogInPage />} />
                <Route path="logout" element={<LogoutPage />} />
                <Route path="password" element={<ResetPasswordPage />} />
                <Route path="password/reset/:id/:token" element={<SetNewPasswordPage />} />

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
            {/* Release popup: one changelog + reload prompt per release. */}
            <WhatsNew/>
        </Router>
    );
}



export default App;

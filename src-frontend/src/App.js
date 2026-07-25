import React, {useEffect, useState, Suspense, lazy} from "react";
import {useSelector, useDispatch, Provider} from 'react-redux';
import './App.css';
import { store } from './utils/store';


import {BrowserRouter as Router, Routes, Route, useLocation} from "react-router-dom";
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

// Lazy-loaded heavy pages - keeps the initial bundle small on mobile.
const MySpace = lazy(() => import("./pages/MySpace"));
const Competition = lazy(() => import("./pages/Competition"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
import {InitStravaLink, ReturnStravaLink} from "./pages/StravaLink";


function App() {
    return (
        <Router>
            <Routes>
                <Route excat path="/" element={<WelcomePage />} />
                <Route excat path="signup" element={<RegisterPage />} />
                <Route excat path="login" element={<LogInPage />} />
                <Route excat path="logout" element={<LogoutPage />} />
                <Route excat path="password" element={<ResetPasswordPage />} />
                <Route excat path="password/reset/:id/:token" element={<SetNewPasswordPage />} />

                <Route excat path="dashboard" element={
                    <Suspense fallback={null}><MySpace/></Suspense>
                } />
                <Route path="competition/:id" element={
                    <Suspense fallback={null}><Competition/></Suspense>
                } />

                <Route excat path="admin/site-settings" element={
                    <Suspense fallback={null}><AdminSettings/></Suspense>
                } />

                <Route excat path="strava/link" element={<InitStravaLink />} />
                <Route excat path="strava/return" element={<ReturnStravaLink />} />

                {/* Add the catch-all route last */}
                <Route path="*" element={<NotFound />} />
            </Routes>

            <BottomNav/>
        </Router>
    );
}



export default App;

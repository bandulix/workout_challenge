import React, {useEffect, useState} from "react";
import {Link, useLocation, useNavigationType, useParams} from "react-router-dom";
import {useDispatch} from 'react-redux';
import {useNavigate} from 'react-router-dom';
import {BarLoader} from "react-spinners";
import {getServerUrl, setServerUrl, hasStoredServerUrl, isNativeApp} from '../utils/platform';
import {PageWrapper} from "../utils/miscellaneous";
import {notice} from "../utils/dialogs";
import {
    apiCreateAccount,
    apiLogin,
    apiRequestNewPassword,
    apiSetNewPassword,
    apiRefreshToken,
    sanitizeRedirect,
} from "../utils/authClient";
import {accessTokenNeedsRefresh, getAccessToken} from "../utils/authTokens";

function BaseHome({children, tagline}) {
    const navType = useNavigationType();
    useEffect(() => {
        if (navType === "POP") {
            document.body.classList.remove("body-no-scroll");
        }
    }, [navType]);

    return (
        <div className="relative z-10 min-h-screen overflow-hidden">
            <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-volt-400/25 blur-3xl z-0"/>

            <div className="relative z-10 flex items-center justify-center min-h-screen px-0 md:px-4">
                <div className="p-8 max-w-2xl text-center text-white my-4 animate-slide-up">

                    <img src="/icon-192.png" alt="" width={56} height={56}
                         className="h-14 w-14 mx-auto mb-5 rounded-2xl shadow-glow-volt animate-float-slow"/>
                    {/* the coaches */}
                    <div className="flex justify-center -space-x-3 mb-6">
                        {["sergeant", "roast", "cheerleader", "butler", "zen"].map((p) => (
                            <img key={p} src={`/personas/${p}.svg`} alt=""
                                 className="h-14 w-14 rounded-full border-2 border-ink-950 shadow-glow-volt"/>
                        ))}
                    </div>

                    <h1 className="font-display text-4xl md:text-6xl uppercase leading-none mb-3">
                        Workout<br/>
                        <span className="text-volt-400">Challenge</span>
                    </h1>
                    <p className="font-display text-xs md:text-sm uppercase tracking-[0.3em] text-gray-400 mb-6">
                        Your AI Drill Instructor
                    </p>
                    <div>
                        {tagline ?? (
                            <p className="text-base md:text-lg text-gray-200 mb-8 leading-relaxed">
                                Compete with friends and co-workers <b className="text-volt-300">across devices</b>,
                                using the <b className="text-volt-300">metrics you want</b>,
                                <b className="text-volt-300"> respecting your privacy</b> —
                                while your personal AI coach keeps the banter coming.
                            </p>
                        )}
                    </div>

                    {children}

                </div>
            </div>
        </div>
    )

}


function useWaitForLocalStorage(key, expectedValue, interval = 500) {
    const [matched, setMatched] = useState(false);

    useEffect(() => {
        const check = () => {
            const value = localStorage.getItem(key);
            if (value === expectedValue) {
                setMatched(true);
            }
        };

        check(); // Initial check
        if (!matched) {
            const id = setInterval(() => {
                check();
            }, interval);

            return () => clearInterval(id);
        }
    }, [key, expectedValue, matched]);

    return matched;
}


function LogoutPage() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const matched = useWaitForLocalStorage("refresh_token", null);

    // Side effects belong in useEffect, not in the render body (they ran
    // twice under StrictMode and triggered update-during-render warnings).
    useEffect(() => {
        // RESET_STORE wipes ALL slice caches (users/workouts/competitions/
        // stats/feed/drillInstructor AND teams/goals/join/link/siteSettings/
        // push) - a partial reset left the rest in the store, and the
        // throttled persistor re-saved them into localStorage seconds after
        // the clear (admin site settings etc. survived "logout").
        dispatch({type: 'RESET_STORE'});
        // Preserve the native app's server address across the wipe -
        // without it the app can't reach the backend after logout.
        const serverUrl = localStorage.getItem('wc_server_url');
        const healthHost = localStorage.getItem('wc_health_host');
        localStorage.clear();
        if (serverUrl !== null) {
            localStorage.setItem('wc_server_url', serverUrl);
        }
        if (healthHost !== null) {
            localStorage.setItem('wc_health_host', healthHost);
        }

        // The service worker caches authenticated GET /api/* responses as
        // its offline fallback (see public/sw.js). Purge them on logout so
        // the previous user's data isn't readable in Cache Storage (or
        // servable offline) on a shared device.
        if ('caches' in window) {
            caches.delete('wc-api').catch(() => { /* best effort */ });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (matched) {
            navigate("/login");
        }
    }, [matched, navigate]);

    useEffect(() => {
        const t = setTimeout(() => navigate("/login"), 4000);
        return () => clearTimeout(t);
    }, [navigate]);

    return (
        <BaseHome>
            <div className="flex justify-center">
                <LoadingForm/>
            </div>
        </BaseHome>
    )
}


function WelcomePage() {
    const location = useLocation();
    const navigate = useNavigate();

    // Session gate: this is the app's cold-start URL (the APK always
    // opens here). With a stored refresh token there is a live session -
    // go straight to the coach page instead of showing the landing page.
    // The dashboard's API queries refresh the access token as needed, and
    // a genuinely expired refresh token bounces back to /login via
    // baseQueryWithReauth - which is the correct end state anyway.
    // replace: the landing page stays out of the history stack, so the
    // Android back button exits the app instead of bouncing back here.
    useEffect(() => {
        if (localStorage.getItem('refresh_token') !== null) {
            const params = new URLSearchParams(location.search);
            navigate(params.get("join") || params.get("action")
                ? `/dashboard${location.search}`
                : `/coach${location.search}`, {replace: true});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <BaseHome>
            <div>
                <Link to={`/signup/${location.search}`}
                      className="inline-block bg-volt-400 text-ink-950 shadow-glow-volt mx-2 px-8 py-3.5 rounded-full font-bold uppercase tracking-wide text-sm hover:bg-volt-300 transition active:scale-95">
                    Create Account
                </Link>
                <Link to={`/login/${location.search}`}
                      className="inline-block bg-white/10 backdrop-blur text-white border border-white/25 mx-2 px-8 py-3.5 rounded-full font-bold uppercase tracking-wide text-sm hover:bg-white/20 transition active:scale-95">
                    Log In
                </Link>
            </div>
        </BaseHome>
    );
}


function goAfterLogin(navigate, location, params) {
    if (params?.has("redirect")) {
        const redirectUrl = sanitizeRedirect(params.get("redirect"));
        if (redirectUrl) {
            navigate(redirectUrl);
            return;
        }
    }
    if (params?.has("join") || params?.has("action")) {
        navigate(`/dashboard${location.search}`);
        return;
    }
    navigate(`/coach${location.search}`);
}


const LoadingForm = () => {
    return (
        <div className="glass-card rounded-3xl px-8 pt-6 pb-8 mb-4 flex items-center justify-center"
             style={{minWidth: '310px'}}>
            <BarLoader height={6} width={200} color="#d7ff3e"/>
        </div>
    )
}



function RegisterPage() {

    const dispatch = useDispatch();
    const location = useLocation();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState([]);
    const navigate = useNavigate();
    // A competition invite link (?join=CODE) doubles as the registration
    // invite - the global invite token is not needed in that case.
    const joinCode = new URLSearchParams(location.search).get('join') || "";

    async function handleSubmit(e) {
        e.preventDefault();
        const email = e.target.email.value;
        const first_name = e.target.first_name.value;
        const last_name = e.target.last_name.value;
        const gender = e.target.gender.value;
        const password1 = e.target.password1.value;
        const password2 = e.target.password2.value;
        const invite_token = e.target.invite_token?.value || "";
        if (typeof (email) === "undefined" || email === null || email === "") {
            setErrorMessage(['Please enter an email address.']);
        } else if (typeof (first_name) === "undefined" || first_name === null || first_name === "") {
            setErrorMessage(['Please enter a first name.']);
        } else if (typeof (password1) === "undefined" || password1 === null || password1 === "") {
            setErrorMessage(['Please enter a password.']);
        } else if (password1 !== password2) {
            setErrorMessage(['Passwords do not match.']);
        } else {
            setIsLoading(true);
            try {
                const [success_register, msg_register] = await apiCreateAccount(email, first_name, last_name, gender, password1, invite_token, joinCode);
                const [success_login, msg_login] = await apiLogin(email, password1);
                const params = new URLSearchParams(location.search);
                if (success_register && success_login) {
                    dispatch({type: "RESET_STORE"});
                    navigate(params.get("join") ? `/dashboard/?${params.toString()}` : `/coach`);
                } else if (!success_register) {
                    setErrorMessage(msg_register.split(", "));
                } else if (!success_login) {
                    setErrorMessage(["Successful Registration", "Login " + msg_login]);
                    navigate(params.get("join") ? `/dashboard/?${params.toString()}` : `/coach`);
                }
            } catch (err) {
                console.error("Registration failed", err);
                setErrorMessage(["Could not register - please try again."]);
            } finally {
                setIsLoading(false);
            }
        }
    };

    const [gender, setGender] = useState('');
    const handleDropDownChange = (e) => {
        setGender(e.target.value);
    }

    useEffect(() => {
        dispatch({type: 'RESET_STORE'});
        // Preserve the native app's server address - wiping it here
        // stranded the registration API calls on the WebView origin.
        const serverUrl = localStorage.getItem('wc_server_url');
        const healthHost = localStorage.getItem('wc_health_host');
        localStorage.clear();
        if (serverUrl !== null) {
            localStorage.setItem('wc_server_url', serverUrl);
        }
        if (healthHost !== null) {
            localStorage.setItem('wc_health_host', healthHost);
        }
    }, []);

    return (
        <BaseHome>

            {
                isLoading ? <LoadingForm/> : (

                    <div className="flex justify-center">
                        <form className="glass-card rounded-3xl px-8 pt-6 pb-8 mb-4" style={{minWidth: '310px'}}
                              onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="email">
                                    Email*
                                </label>
                                <input
                                    className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                    id="email" type="text" placeholder="Email" autoFocus="True" tabIndex="1"/>
                            </div>
                            <div className="mb-4">
                                <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="first_name">
                                    First Name*
                                </label>
                                <input
                                    className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                    id="first_name" type="text" placeholder="First Name" tabIndex="2"/>
                            </div>
                            <div className="mb-4">
                                <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="last_name">
                                    Last Name
                                </label>
                                <input
                                    className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                    id="last_name" type="text" placeholder="Last Name" tabIndex="3"/>
                            </div>
                            <div className="mb-4">
                                <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="gender">
                                    Gender
                                </label>
                                <select
                                    className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                    id="gender" value={gender} tabIndex="4" onChange={handleDropDownChange}>
                                    <option value=''>--Please choose an option--</option>
                                    <option value='M'>Male</option>
                                    <option value='F'>Female</option>
                                    <option value='O'>Other</option>
                                    <option value=''>Don't want to tell</option>
                                </select>
                            </div>
                            <div className="mb-6">
                                <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="password1">
                                    Password*
                                </label>
                                <input
                                    className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                    id="password1" type="password" placeholder="******************" tabIndex="5"/>
                            </div>
                            <div className="mb-6">
                                <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="password2">
                                    Repeat Password*
                                </label>
                                <input
                                    className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                    id="password2" type="password" placeholder="******************" tabIndex="6"/>
                            </div>
                            <div className="mb-6">
                                <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="invite_token">
                                    Invite Token{joinCode ? "" : "*"}
                                </label>
                                <input
                                    className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                    id="invite_token" type="text" placeholder="Ask your inviter for the token" tabIndex="7"/>
                                <p className="text-xs text-gray-500 mt-1">
                                    {joinCode
                                        ? "You opened a competition invite link - no token needed."
                                        : "Registration is by invitation only."}
                                </p>
                            </div>
                            <div className="flex items-center justify-between">
                                <button
                                    className="bg-volt-400 hover:bg-volt-300 text-ink-950 font-bold py-2.5 px-5 rounded-full uppercase tracking-wide text-sm transition focus:outline-none mr-2 sm:mr-10"
                                    type="submit" tabIndex="8">
                                    Create Account
                                </button>
                                <Link to={`/login/${location.search}`}
                                      className="inline-block align-baseline font-bold text-sm text-volt-400 hover:text-volt-300 ml-2"
                                      tabIndex="9">
                                    Go to SignIn
                                </Link>
                            </div>
                            <p id="errors" className="text-red-500 text-xs italic mt-5">
                                {errorMessage.map((item, index) => (
                                    <span key={'error' + index}>{item}<br/></span>
                                ))}
                            </p>
                        </form>
                    </div>
                )}
        </BaseHome>
    );
}


// Native app only: one-time server address entry on the login screen.
// One APK works on every instance - the app cannot know where it was
// downloaded from, so the user tells it once (pre-filled when the APK
// was built per-deployment with MAIN_HOST baked in). Saving reloads so
// every resolver picks the value up.
//
// RENDERED OUTSIDE the login form, on purpose: when this <form> was
// nested inside it, the submit event never crossed the inner form
// boundary while bubbling (it stops propagating at the outer form), so
// React's root-delegated onSubmit never fired - "Save & reload" did
// nothing at all and the server address was never stored (reproduced in
// headless Chromium).
function ServerField() {
    const [url, setUrl] = useState(getServerUrl());
    const [editing, setEditing] = useState(!hasStoredServerUrl() && !(process.env.REACT_APP_BACKEND_URL || ""));

    if (!isNativeApp()) return null;

    function save(e) {
        e.preventDefault();
        setServerUrl(url);
        window.location.reload();
    }

    if (!editing) {
        return (
            <p className="mt-4 text-center">
                <button type="button" onClick={() => setEditing(true)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition">
                    Server: {getServerUrl() || "not set"} — <span className="underline">change</span>
                </button>
            </p>
        );
    }

    return (
        <form onSubmit={save} className="mt-5 rounded-2xl border border-ink-700/60 bg-ink-900/60 p-4">
            <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="server-url">
                Server address
            </label>
            <input
                className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                id="server-url" type="url" placeholder="https://workout.example.com"
                value={url} onChange={(e) => setUrl(e.target.value)} required={true}/>
            <p className="mt-1.5 text-[11px] text-gray-500">
                The address of your Workout Challenge server (where you downloaded this app).
            </p>
            <button type="submit"
                    className="mt-3 w-full bg-volt-400 hover:bg-volt-300 text-ink-950 font-bold py-2.5 px-5 rounded-full uppercase tracking-wide text-sm transition">
                Save & reload
            </button>
        </form>
    );
}


function LogInPage() {

    const dispatch = useDispatch();
    const location = useLocation();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const params = new URLSearchParams(window.location.search);

    // handle submit/login action from login form
    async function handleSubmit(e) {
        e.preventDefault();
        setErrorMessage(null);
        setIsLoading(true);
        const email = e.target.email.value;
        const password = e.target.password.value;
        try {
            const [success, msg] = await apiLogin(email, password);
            if (!success) {
                setErrorMessage(msg);
                return;
            }
            // A fresh login must mean fresh data: drop the persisted Redux
            // cache (localStorage 'appState') from whatever session was on
            // this device before - otherwise a stale cache (e.g. "no coach
            // configured") survives the login and the device looks out of
            // sync. The JWT tokens just set by apiLogin live in their own
            // keys and are not touched.
            localStorage.removeItem("appState");
            localStorage.removeItem("wc_equalizer_inputs");
            localStorage.removeItem("wc_last_coach_msg_id");
            dispatch({type: "RESET_STORE"});
            goAfterLogin(navigate, location, params);
        } catch (err) {
            console.error("Login failed", err);
            setErrorMessage("Could not log in - please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        let cancelled = false;
        dispatch({type: "RESET_STORE"});

        const refreshToken = localStorage.getItem("refresh_token");
        if (!refreshToken) return undefined;

        (async () => {
            setIsLoading(true);
            try {
                // A still-valid access token is enough - do not delete it
                // and wait on refresh. That used to park the login page
                // on the spinner if refresh was slow or never returned.
                if (getAccessToken() && !accessTokenNeedsRefresh()) {
                    if (!cancelled) goAfterLogin(navigate, location, params);
                    return;
                }
                const timedOut = await Promise.race([
                    apiRefreshToken(refreshToken).then((r) => r),
                    new Promise((resolve) => setTimeout(() => resolve(["timeout"]), 8000)),
                ]);
                if (cancelled) return;
                if (timedOut[0] === true) {
                    goAfterLogin(navigate, location, params);
                    return;
                }
                // Refresh hung or failed, but a still-valid access token
                // is enough to enter the app.
                if (getAccessToken() && !accessTokenNeedsRefresh()) {
                    goAfterLogin(navigate, location, params);
                    return;
                }
            } catch {
                // Show the form so the user can sign in by password.
            }
            if (!cancelled) setIsLoading(false);
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


    return (
        <BaseHome tagline={
            <p className="text-base md:text-lg text-gray-200 mb-8 leading-relaxed">
                Welcome back, challenger. While you were away, your <b className="text-volt-300">rivals kept
                training</b>, the <b className="text-volt-300">leaderboard kept moving</b> —
                and your Drill Instructor <b className="text-volt-300">kept score</b>. Time to answer for it.
            </p>
        } children={
            <div className="flex justify-center">
                {
                    isLoading ? <LoadingForm/> : (

                        <div>
                            <form className="glass-card rounded-3xl px-8 pt-6 pb-8 mb-4" style={{minWidth: '310px'}}
                                  onSubmit={handleSubmit}>
                                <div className="mb-4">
                                    <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="email">
                                        Email
                                    </label>
                                    <input
                                        className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                        id="email" type="text" placeholder="Email" autoFocus="True" tabIndex="1"
                                        required={true}/>
                                </div>
                                <div className="mb-6">
                                    <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="password">
                                        Password
                                    </label>
                                    <input
                                        className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                        id="password" type="password" placeholder="******************" tabIndex="2"
                                        required={true}/>
                                    <Link to={`/password/`} className="button italic text-sm text-volt-400 hover:text-volt-300"
                                          tabIndex="3">
                                        Forgot Password?
                                    </Link>
                                </div>
                                <div className="flex items-center justify-between">
                                    <button
                                        className="bg-volt-400 hover:bg-volt-300 text-ink-950 font-bold py-2.5 px-5 rounded-full uppercase tracking-wide text-sm transition focus:outline-none mr-2 sm:mr-16"
                                        type="submit" tabIndex="4">
                                        Sign In
                                    </button>
                                    <Link to={`/signup/${location.search}`}
                                          className="inline-block align-baseline font-bold text-sm text-volt-400 hover:text-volt-300 ml-2"
                                          tabIndex="5">
                                        Create Account
                                    </Link>
                                </div>
                                <p className="text-red-500 text-xs italic mt-5">{errorMessage}</p>
                            </form>
                            {/* Must stay OUTSIDE the login form - nested forms
                                break React's submit delegation (see ServerField). */}
                            <ServerField/>
                        </div>
                    )
                }
            </div>
        }/>
    );
}


function ResetPasswordPage() {

    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    // handle submit/reset action from reset password form
    async function handleSubmit(e) {
        e.preventDefault();
        setErrorMessage(null);
        setIsLoading(true);
        const email = e.target.email.value;
        const [success, msg] = await apiRequestNewPassword(email);
        if (success) {
            // success reset request - redirect to start page
            notice('Success! Please check your email for a reset link.');
            setIsLoading(false);
            navigate(`/`);
        } else {
            // error reset request - user try again
            setErrorMessage(msg);
            setIsLoading(false);
        }
    }

    return (
        <BaseHome children={
            <div className="flex justify-center">
                {
                    isLoading ? <LoadingForm/> : (
                    <form onSubmit={handleSubmit} className="glass-card rounded-3xl px-8 pt-6 pb-8 mb-4" style={{minWidth: '310px'}}>
                        <div className="mb-4">
                            <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="email" autoFocus="True">
                                Email
                            </label>
                            <input
                                className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                id="email" type="text" placeholder="Email" autoFocus="True" tabIndex="1"/>
                        </div>
                        <div className="flex items-center justify-between">
                            <button
                                className="bg-volt-400 hover:bg-volt-300 text-ink-950 font-bold py-2.5 px-5 rounded-full uppercase tracking-wide text-sm transition focus:outline-none mr-2 sm:mr-16"
                                type="submit" tabIndex="2">
                                Reset Password
                            </button>
                            <Link to="/login"
                                  className="inline-block align-baseline font-bold text-sm text-volt-400 hover:text-volt-300 ml-2"
                                  tabIndex="3">
                                Back to SignIn
                            </Link>
                        </div>
                        <p className="text-red-500 text-xs italic mt-5">{ errorMessage }</p>
                    </form>
                )}
            </div>
        }/>
    );
}


function SetNewPasswordPage() {
    const {id, token} = useParams();

    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    // handle submit/reset action from reset password form
    async function handleSubmit(e) {
        e.preventDefault();
        setErrorMessage(null);
        setIsLoading(true);
        const password1 = e.target.password1.value;
        const password2 = e.target.password2.value;
        if (typeof (password1) === "undefined" || password1 === null || password1 === "") {
            setErrorMessage(['Please enter a password.']);
            setIsLoading(false);
        } else if (password1 !== password2) {
            setErrorMessage(['Passwords do not match.']);
            setIsLoading(false);
        } else {
            const [success, msg] = await apiSetNewPassword(id, token, password1);
            if (success) {
                // success reset password - redirect to login page
                setIsLoading(false);
                    navigate(`/login/`);
            } else {
                // error resetting password - user try again
                setErrorMessage(msg);
                setIsLoading(false);
            }
        }
    }

    return (
        <BaseHome children={
            <div className="flex justify-center">
                {
                    isLoading ? <LoadingForm/> : (
                    <form onSubmit={handleSubmit} className="glass-card rounded-3xl px-8 pt-6 pb-8 mb-4" style={{minWidth: '45%'}}>
                        <div className="mb-6">
                            <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="password1">
                                Password
                            </label>
                            <input
                                className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                id="password1" type="password" placeholder="******************" tabIndex="1" autoFocus={true}/>
                        </div>
                        <div className="mb-6">
                            <label className="block text-gray-300 text-sm font-bold mb-2" htmlFor="password2">
                                Repeat Password
                            </label>
                            <input
                                className="appearance-none border border-ink-700/60 rounded-xl w-full py-2.5 px-3 bg-ink-900 text-gray-100 placeholder-gray-500 leading-tight focus:outline-none focus:border-volt-500 transition"
                                id="password2" type="password" placeholder="******************" tabIndex="2"/>
                        </div>
                        <div className="flex items-center justify-between">
                            <button
                                className="bg-volt-400 hover:bg-volt-300 text-ink-950 font-bold py-2.5 px-5 rounded-full uppercase tracking-wide text-sm transition focus:outline-none mx-auto sm:mx-16"
                                type="submit" tabIndex="3">
                                Reset Password
                            </button>
                        </div>
                        <p className="text-red-500 text-xs italic mt-5">{ errorMessage }</p>
                    </form>
                )}
            </div>
        }/>
    );
}


// NotFound page
const NotFound = () => {
    return (
        <PageWrapper>
            <div className="flex flex-col items-center justify-center min-h-screen">
                <h1 className="text-4xl font-bold mb-4">404</h1>
                <p className="text-xl mb-4">Page Not Found</p>
                <p className="mb-8">The page you're looking for doesn't exist or has been moved.</p>
                <Link to="/dashboard" className="text-volt-700 dark:text-volt-300 font-semibold hover:underline">
                    Go to Home
                </Link>
            </div>
        </PageWrapper>
    );
};


export {WelcomePage, NotFound, RegisterPage, LogInPage, LogoutPage, ResetPasswordPage, SetNewPasswordPage};
// Auth HTTP lives in utils/authClient.js (same RTK baseQuery as the rest of the app).
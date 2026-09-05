import React, {useEffect, useState} from "react";
import {Link, useLocation, useNavigationType, useParams} from "react-router-dom";
import {useDispatch} from 'react-redux';
import {useNavigate} from 'react-router-dom';
import {BarLoader} from "react-spinners";
import ServerField from '../components/ServerField';
import {PageWrapper} from "../utils/miscellaneous";
import {notice} from "../utils/dialogs";
import {
    apiCreateAccount,
    apiLogin,
    apiRequestNewPassword,
    apiSetNewPassword,
    apiConfirmEmail,
    apiRefreshToken,
    sanitizeRedirect,
} from "../utils/authClient";
import {
    accessTokenNeedsRefresh,
    apiLogoutRefresh,
    ensureFreshAccessToken,
    getAccessToken,
    hasAuthMarker,
    markLoggedOut,
} from "../utils/authTokens";
import {readLastPath} from "../utils/lastPath";
import {clearBodyScrollLock} from "../utils/overlay";
import {GlassSelect} from "../forms/basicComponents";



function BaseHome({children, tagline}) {
    const navType = useNavigationType();
    useEffect(() => {
        if (navType === "POP") {
            clearBodyScrollLock();
        }
    }, [navType]);

    return (
        <div className="relative z-10 min-h-screen overflow-hidden">
            <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-volt-400/25 blur-3xl z-0"/>

            <div className="relative z-10 flex items-center justify-center min-h-screen px-0 md:px-4">
                <div className="p-8 max-w-2xl text-center text-white my-4 animate-slide-up">

                    <img src="/icon-192.png" alt="" width={56} height={56}
                         className="h-14 w-14 mx-auto mb-5 rounded-2xl shadow-glow-volt animate-float-slow"/>
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


function LogoutPage() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [matched, setMatched] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await apiLogoutRefresh();
            markLoggedOut();
            dispatch({type: 'RESET_STORE'});
            const serverUrl = localStorage.getItem('wc_server_url');
            const healthHost = localStorage.getItem('wc_health_host');
            localStorage.clear();
            if (serverUrl !== null) localStorage.setItem('wc_server_url', serverUrl);
            if (healthHost !== null) localStorage.setItem('wc_health_host', healthHost);

            if ('caches' in window) {
                caches.delete('wc-api').catch(() => {});
            }
            if (navigator.serviceWorker?.controller) {
                navigator.serviceWorker.controller.postMessage({type: 'CLEAR_API_CACHE'});
            }
            import("../utils/protectedMedia").then(({clearProtectedImageCache}) => {
                clearProtectedImageCache();
            }).catch(() => {});
            if (!cancelled) setMatched(true);
        })();
        return () => { cancelled = true; };
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

    useEffect(() => {
        (async () => {
            const status = await ensureFreshAccessToken();
            if (status === 'ok' || getAccessToken() || hasAuthMarker()) {
                const params = new URLSearchParams(location.search);
                navigate(params.get("join") || params.get("action")
                    ? `/dashboard${location.search}`
                    : readLastPath(), {replace: true});
            }
        })();
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



function LogInPage() {

    const dispatch = useDispatch();
    const location = useLocation();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const params = new URLSearchParams(window.location.search);

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

        (async () => {
            setIsLoading(true);
            try {
                if (getAccessToken() && !accessTokenNeedsRefresh()) {
                    if (!cancelled) goAfterLogin(navigate, location, params);
                    return;
                }
                const timedOut = await Promise.race([
                    apiRefreshToken().then((r) => r),
                    new Promise((resolve) => setTimeout(() => resolve(["timeout"]), 8000)),
                ]);
                if (cancelled) return;
                if (timedOut[0] === true) {
                    goAfterLogin(navigate, location, params);
                    return;
                }
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
                            <ServerField/>
                        </div>
                    )
                }
            </div>
        }/>
    );
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
                    await notice("Account created. Confirm your email — we sent a link. Coach emails start after that.");
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
                                <GlassSelect
                                    id="gender"
                                    name="gender"
                                    value={gender}
                                    tabIndex="4"
                                    placeholder="--Please choose an option--"
                                    onChange={setGender}
                                    includeBlank={false}
                                    options={[
                                        {value: "", label: "--Please choose an option--"},
                                        {value: "M", label: "Male"},
                                        {value: "F", label: "Female"},
                                        {value: "O", label: "Other"},
                                    ]}
                                />
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


function ResetPasswordPage() {

    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setErrorMessage(null);
        setIsLoading(true);
        const email = e.target.email.value;
        const [success, msg] = await apiRequestNewPassword(email);
        if (success) {
            notice('Success! Please check your email for a reset link.');
            setIsLoading(false);
            navigate(`/`);
        } else {
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
                setIsLoading(false);
                    navigate(`/login/`);
            } else {
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


function VerifyEmailPage() {
    const {id, token} = useParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState("working");
    const started = React.useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        apiConfirmEmail(id, token).then(([ok]) => {
            setStatus((prev) => (prev === "ok" || ok ? "ok" : "err"));
        });
    }, [id, token]);

    return (
        <BaseHome children={
            <div className="flex justify-center">
                <div className="glass-card rounded-3xl px-8 pt-6 pb-8 mb-4 text-left" style={{minWidth: "310px"}}>
                    {status === "working" && <p className="text-gray-300">Confirming your email…</p>}
                    {status === "ok" && (
                        <>
                            <p className="text-gray-100 font-bold mb-2">Email confirmed.</p>
                            <p className="text-gray-400 text-sm mb-5">Welcome mail is on its way. You can use the app now.</p>
                            <button type="button"
                                    className="bg-volt-400 hover:bg-volt-300 text-ink-950 font-bold py-2.5 px-5 rounded-full uppercase tracking-wide text-sm"
                                    onClick={() => navigate("/coach")}>
                                Open the app
                            </button>
                        </>
                    )}
                    {status === "err" && (
                        <>
                            <p className="text-gray-100 font-bold mb-2">This link is invalid or has expired.</p>
                            <p className="text-gray-400 text-sm mb-5">Log in and tap Resend on the yellow bar to get a new one.</p>
                            <Link to="/login" className="inline-block align-baseline font-bold text-sm text-volt-400 hover:text-volt-300">
                                Back to sign in
                            </Link>
                        </>
                    )}
                </div>
            </div>
        }/>
    );
}


export {WelcomePage, NotFound, RegisterPage, LogInPage, LogoutPage, ResetPasswordPage, SetNewPasswordPage, VerifyEmailPage};

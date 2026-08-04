import React, {useEffect, useState} from "react";
import {Link, useLocation, useNavigationType, useParams} from "react-router-dom";
import {useDispatch} from 'react-redux';
import {useNavigate} from 'react-router-dom';
import {BarLoader} from "react-spinners";
import {usersApi} from '../utils/reducers/usersSlice';
import {workoutsApi} from '../utils/reducers/workoutsSlice';
import {competitionsApi} from '../utils/reducers/competitionsSlice';
import {statsApi} from '../utils/reducers/statsSlice';
import {feedApi} from '../utils/reducers/feedSlice';
import {drillInstructorApi} from '../utils/reducers/drillInstructorSlice';
import {getServerUrl, setServerUrl, hasStoredServerUrl, isNativeApp} from '../utils/serverUrl';
import {PageWrapper} from "../utils/miscellaneous";
import {sentryError} from "../utils/reducers/baseQueryWithReauth";

function BaseHome({children, tagline}) {
    const navType = useNavigationType();
    useEffect(() => {
        if (navType === "POP") {
            document.body.classList.remove("body-no-scroll");
        }
    }, [navType]);

    return (
        <div className="relative min-h-screen bg-cover bg-center bg-ink-950"
             style={{backgroundImage: "url('/running.webp')"}}>

            <div className="absolute inset-0 bg-gradient-to-b from-ink-950/80 via-ink-950/70 to-ink-950/95 z-0"></div>
            <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-volt-400/20 blur-3xl z-0"></div>

            <div className="relative z-10 flex items-center justify-center min-h-screen px-0 md:px-4">
                <div className="p-8 max-w-2xl text-center text-white my-4 animate-slide-up">

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
        console.log('Clear localStorage as new user wants to register');
        dispatch(usersApi.util.resetApiState());
        dispatch(workoutsApi.util.resetApiState());
        dispatch(competitionsApi.util.resetApiState());
        dispatch(statsApi.util.resetApiState());
        dispatch(feedApi.util.resetApiState());
        dispatch(drillInstructorApi.util.resetApiState());
        localStorage.clear();

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


const waitForLocalStorage = (key, timeout = 5000) =>
    new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
            const val = localStorage.getItem(key);
            if (val !== null) {
                clearInterval(interval);
                resolve(val);
            } else if (Date.now() - start > timeout) {
                clearInterval(interval);
                reject(new Error('Timeout waiting for localStorage key'));
            }
        }, 100);
    });


const LoadingForm = () => {
    return (
        <div className="bg-ink-850/95 backdrop-blur border border-ink-700/60 shadow-card-dark rounded-3xl px-8 pt-6 pb-8 mb-4 flex items-center justify-center"
             style={{minWidth: '310px'}}>
            <BarLoader height={6} width={200}/>
        </div>
    )
}


const apiCreateAccount = async (email, first_name, last_name, gender, password, invite_token, join_code) => {
    try {
        const response = await fetch(getServerUrl() + '/api/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email.toLowerCase(),
                first_name: first_name,
                last_name: last_name,
                gender: gender,
                password: password,
                invite_token: invite_token,
                join_code: join_code || ""
            }),
        });
        
        if (response.ok) {
            console.log('Registration Success');
            return [true, undefined];
        } else {
            console.log('Registration Error:', response.status, response.statusText);
            let error_msg = 'Registration Error (' + response.status + '): ' + response.statusText + ', ';
            try {
                const error = await response.json();
                for (const key in error) {
                    error_msg += key + ': ' + error[key] + ', ';
                }
            } catch (e) {
                error_msg += ' Unknown error';
            }
            return [false, error_msg];
        }
    } catch (error) {
        console.error('Network or server error during registration:', error);
        // Capture network errors in Sentry
        sentryError({
            result: error,
            errorSource: 'manual-api',
            endpointName: 'register',
        });
        return [false, 'Network or server error occurred. Please try again.'];
    }
}

const apiLogin = async (email, password) => {
    try {
        const response = await fetch(getServerUrl() + '/api/token/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email.toLowerCase(),
                password: password
            }),
        });

        if (response.ok) {
            console.log('Login Successful');
            const token = await response.json();
            localStorage.setItem('access_token', token.access);
            localStorage.setItem('refresh_token', token.refresh);
            return [true, undefined];
        } else {
            console.log('Login Error:', response.status, response.statusText);
            let parsedError = null;
            try {
                parsedError = await response.json();
            } catch (e) {
                parsedError = null;
            }
            return [false, response.statusText + ' (' + response.status + ') - ' + (parsedError ? parsedError.detail : 'Unknown error')];
        }
    } catch (error) {
        console.error('Network or server error during login:', error);
        // Capture network errors in Sentry
        sentryError({
            result: error,
            errorSource: 'manual-api',
            endpointName: 'login',
        });
        return [false, 'Network or server error occurred. Please try again.'];
    }
};


const apiRequestNewPassword = async (email) => {
    try {
        const response = await fetch(getServerUrl() + '/api/password-reset/request/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
            }),
        });
        
        if (response.ok) {
            console.log('Password Reset Request Successful');
            return [true, undefined];
        } else {
            console.log('Password Reset Request Error:', response.status, response.statusText, response);
            let parsedError = null;
            try {
                parsedError = await response.json();
            } catch (e) {
                parsedError = null;
            }
            return [false, response.statusText + ' (' + response.status + ') - ' + (parsedError ? parsedError.detail : 'Unknown error')];
        }
    } catch (error) {
        console.error('Network or server error during password reset request:', error);
        // Capture network errors in Sentry
        sentryError({
            result: error,
            errorSource: 'manual-api',
            endpointName: 'new-password-request',
        });
        return [false, 'Network or server error occurred. Please try again.'];
    }
};


const apiSetNewPassword = async (uid, token, newPassword) => {
    try {
        const response = await fetch(getServerUrl() + '/api/password-reset/confirm/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                uid: uid,
                token: token,
                new_password: newPassword,
            }),
        });

        if (response.ok) {
            console.log('Set New Password Successful');
            return [true, undefined];
        } else {
            console.log('Set New Password Error:', response.status, response.statusText, response);
            let parsedError = null;
            try {
                parsedError = await response.json();
            } catch (e) {
                parsedError = null;
            }
            return [false, response.statusText + ' (' + response.status + ') - ' + (parsedError ? parsedError.detail : 'Unknown error')];
        }
    } catch (error) {
        console.error('Network or server error during password reset:', error);
        // Capture network errors in Sentry
        sentryError({
            result: error,
            errorSource: 'manual-api',
            endpointName: 'set-new-password',
        });
        return [false, 'Network or server error occurred. Please try again.'];
    }
}


// Only honour a redirect target if it points at the same origin and
// is a real path. Anything else (absolute URL, javascript:, protocol-
// relative //evil.com) is dropped to prevent open-redirect abuse.
function sanitizeRedirect(value) {
    if (!value) return null;
    let raw;
    try {
        raw = decodeURIComponent(value);
    } catch (e) {
        return null;
    }
    if (!raw || typeof raw !== 'string') return null;
    // Must start with a single forward slash and a second char that's
    // not '/' or '\' (avoids protocol-relative URLs).
    if (!raw.startsWith('/')) return null;
    if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
    // Reject anything that looks like a scheme prefix followed by
    // characters (e.g. '/javascript:foo'). Same-origin query strings
    // may contain '://' inside values and that's fine - we only look
    // for the scheme prefix.
    if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
    return raw;
}


const apiRefreshToken = async (refreshToken) => {
    try {
        const response = await fetch(getServerUrl() + '/api/token/refresh/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                refresh: refreshToken,
            }),
        });
        
        if (response.ok) {
            console.log('Token Refresh Successful');
            const token = await response.json();
            localStorage.setItem('access_token', token.access);
            return [true, undefined];
        } else {
            console.log('Token Refresh Error:', response.status, response.statusText);
            let error = null;
            try {
                error = await response.json();
            } catch (e) {
                error = { detail: 'Unknown error' };
            }
            localStorage.removeItem('refresh_token');
            return [false, response.statusText + ' (' + response.status + ') - ' + error.detail];
        }
    } catch (error) {
        console.error('Network or server error during token refresh:', error);
        localStorage.removeItem('refresh_token');
        // Capture network errors in Sentry
        sentryError({
            result: error,
            errorSource: 'manual-api',
            endpointName: 'refresh-token',
        });
        return [false, 'Network or server error occurred during token refresh. Please try again.'];
    }
};


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
            const [success_register, msg_register] = await apiCreateAccount(email, first_name, last_name, gender, password1, invite_token, joinCode);
            const [success_login, msg_login] = await apiLogin(email, password1);
            const params = new URLSearchParams(location.search);
            if (success_register && success_login) {
                await waitForLocalStorage('access_token');
                // Never log token values - console output ends up in
                // Sentry breadcrumbs and shared-device devtools.
                console.log('Register and Login Successful - redirect');
                navigate(`/dashboard/?${params.toString()}`);
            } else if (!success_register) {
                setErrorMessage(msg_register.split(", "));
            } else if (!success_login) {
                setErrorMessage(['Successful Registration', 'Login ' + msg_login]);
                navigate(`/dashboard/?${params.toString()}`);
            }
            setIsLoading(false);
        }
    };

    const [gender, setGender] = useState('');
    const handleDropDownChange = (e) => {
        setGender(e.target.value);
    }

    useEffect(() => {
        console.log('Clear localStorage as new user wants to register');
        dispatch(usersApi.util.resetApiState());
        dispatch(workoutsApi.util.resetApiState());
        dispatch(competitionsApi.util.resetApiState());
        dispatch(statsApi.util.resetApiState());
        dispatch(feedApi.util.resetApiState());
        dispatch(drillInstructorApi.util.resetApiState());
        localStorage.clear();
    }, []);

    return (
        <BaseHome>

            {
                isLoading ? <LoadingForm/> : (

                    <div className="flex justify-center">
                        <form className="bg-ink-850/95 backdrop-blur border border-ink-700/60 shadow-card-dark rounded-3xl px-8 pt-6 pb-8 mb-4" style={{minWidth: '310px'}}
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
        const [success, msg] = await apiLogin(email, password);
        if (success) {
            // A fresh login must mean fresh data: drop the persisted Redux
            // cache (localStorage 'appState') from whatever session was on
            // this device before - otherwise a stale cache (e.g. "no coach
            // configured") survives the login and the device looks out of
            // sync. The JWT tokens just set by apiLogin live in their own
            // keys and are not touched.
            localStorage.removeItem('appState');
            dispatch(usersApi.util.resetApiState());
            dispatch(workoutsApi.util.resetApiState());
            dispatch(competitionsApi.util.resetApiState());
            dispatch(statsApi.util.resetApiState());
            dispatch(feedApi.util.resetApiState());
            dispatch(drillInstructorApi.util.resetApiState());
            // success logging in - redirect to dashboard
            await waitForLocalStorage('access_token');
            setIsLoading(false);
            console.log('redirect');
            if (params.has('redirect')) {
                // Only honour the redirect param when it points at a
                // same-origin path. Anything else (absolute URL, scheme
                // like javascript:, protocol-relative //evil.com) is
                // dropped to prevent open-redirect abuse.
                const redirectUrl = sanitizeRedirect(params.get('redirect'));
                if (redirectUrl) {
                    console.log('Redirect to:', redirectUrl);
                    navigate(redirectUrl);
                } else {
                    navigate(`/dashboard/${location.search}`);
                }
            } else {
                navigate(`/dashboard/${location.search}`);
            }
        } else {
            // error logging in - user try again
            setErrorMessage(msg);
            setIsLoading(false);
        }
    }

    // check if refreshToken already exists and user is already logged in
    async function checkRefreshToken(refreshToken) {
        console.log('refresh_token already exists - check if still valid');
        setIsLoading(true);
        const [success] = await apiRefreshToken(refreshToken);
        if (success) {
            // success refreshing access_token - redirecting to dashboard
            await waitForLocalStorage('access_token');
            console.log('refresh_token exists and is valid - redirect');
            navigate(`/dashboard/${location.search}`);
        } else {
            // error refreshing access_token - manual login required
            localStorage.removeItem('refresh_token');
            console.log('refresh_token exists but expired - new login required');
        }
        setIsLoading(false);
    }

    useEffect(() => {
        dispatch(usersApi.util.resetApiState());
        dispatch(workoutsApi.util.resetApiState());
        dispatch(competitionsApi.util.resetApiState());
        dispatch(statsApi.util.resetApiState());
        dispatch(feedApi.util.resetApiState());
        dispatch(drillInstructorApi.util.resetApiState());

        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken !== null) {
            localStorage.removeItem('access_token');
            checkRefreshToken(refreshToken);
        }
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

                        <form className="bg-ink-850/95 backdrop-blur border border-ink-700/60 shadow-card-dark rounded-3xl px-8 pt-6 pb-8 mb-4" style={{minWidth: '310px'}}
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
                            <ServerField/>
                        </form>
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
            window.alert('Success! Please check your email for a reset link.');
            setIsLoading(false);
            console.log('redirect to login page');
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
                    <form onSubmit={handleSubmit} className="bg-ink-850/95 backdrop-blur border border-ink-700/60 shadow-card-dark rounded-3xl px-8 pt-6 pb-8 mb-4" style={{minWidth: '310px'}}>
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
                console.log('redirect to login page');
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
                    <form onSubmit={handleSubmit} className="bg-ink-850/95 backdrop-blur border border-ink-700/60 shadow-card-dark rounded-3xl px-8 pt-6 pb-8 mb-4" style={{minWidth: '45%'}}>
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
                <Link to="/dashboard" className="text-blue-500 hover:text-blue-700">
                    Go to Home
                </Link>
            </div>
        </PageWrapper>
    );
};


export {WelcomePage, NotFound, RegisterPage, LogInPage, LogoutPage, ResetPasswordPage, SetNewPasswordPage};
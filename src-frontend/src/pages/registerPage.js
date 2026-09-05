import React, {useEffect, useState} from "react";
import {Link, useLocation, useParams} from "react-router-dom";
import {useDispatch} from "react-redux";
import {useNavigate} from "react-router-dom";
import {PageWrapper} from "../utils/miscellaneous";
import {notice} from "../utils/dialogs";
import {
    apiCreateAccount,
    apiLogin,
    apiRequestNewPassword,
    apiSetNewPassword,
    apiConfirmEmail,
} from "../utils/authClient";
import {GlassSelect} from "../forms/basicComponents";
import {BaseHome, LoadingForm} from "./sessionPages";

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



export {RegisterPage};

import React, {useEffect, useState} from "react";
import {Link, useParams} from "react-router-dom";
import {useNavigate} from "react-router-dom";
import {PageWrapper} from "../utils/miscellaneous";
import {notice} from "../utils/dialogs";
import {
    apiRequestNewPassword,
    apiSetNewPassword,
    apiConfirmEmail,
} from "../utils/authClient";
import {BaseHome, LoadingForm} from "./sessionPages";

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


export {NotFound, ResetPasswordPage, SetNewPasswordPage, VerifyEmailPage};

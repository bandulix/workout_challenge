import {useState} from "react";
import {useLocation} from "react-router-dom";
import {X} from "lucide-react";
import {useGetUserByIdQuery, useEmailVerifyResendMutation} from "../utils/reducers/usersSlice";
import {isPublicPath} from "../utils/publicPath";
import {toast} from "../utils/toasts";

// Snooze per browser: the banner returns on the next visit until the
// address is confirmed (it's important), but it must be dismissible.
const SNOOZE_KEY = "wc_verify_banner_snoozed";

export default function VerifyEmailBanner() {
    const location = useLocation();
    const onPublic = isPublicPath(location.pathname);
    const {data: user} = useGetUserByIdQuery("me", {skip: onPublic});
    const [resend, {isLoading}] = useEmailVerifyResendMutation();
    const [snoozed, setSnoozed] = useState(() => {
        try { return sessionStorage.getItem(SNOOZE_KEY) === "1"; } catch { return false; }
    });
    if (onPublic || !user || user.is_verified || snoozed) return null;

    async function handleResend() {
        try {
            await resend().unwrap();
            toast.success("Check your inbox for a confirmation link.");
        } catch (err) {
            const detail = err?.data?.detail || "Could not send another link yet.";
            toast.error(detail);
        }
    }

    function dismiss() {
        try { sessionStorage.setItem(SNOOZE_KEY, "1"); } catch { /* private mode */ }
        setSnoozed(true);
    }

    return (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto mx-auto max-w-lg rounded-2xl glass-card border border-volt-400/50 px-4 py-3 flex items-center gap-3"
                 role="status">
                <p className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-200">
                    Confirm <span className="font-bold text-volt-700 dark:text-volt-400">{user.email}</span> to get coach emails.
                </p>
                <button type="button" disabled={isLoading} onClick={handleResend}
                        className="shrink-0 rounded-full bg-volt-400 px-3.5 py-2 min-h-[44px] text-[11px] font-bold uppercase tracking-wide text-ink-950 disabled:opacity-50">
                    Resend
                </button>
                <button type="button" onClick={dismiss} aria-label="Dismiss for this session"
                        className="shrink-0 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition">
                    <X className="h-4 w-4"/>
                </button>
            </div>
        </div>
    );
}

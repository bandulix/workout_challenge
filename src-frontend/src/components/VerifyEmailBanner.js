import {useLocation} from "react-router-dom";
import {useGetUserByIdQuery, useEmailVerifyResendMutation} from "../utils/reducers/usersSlice";
import {isPublicPath} from "../utils/publicPath";
import {notice} from "../utils/dialogs";

export default function VerifyEmailBanner() {
    const location = useLocation();
    const onPublic = isPublicPath(location.pathname);
    const {data: user} = useGetUserByIdQuery("me", {skip: onPublic});
    const [resend, {isLoading}] = useEmailVerifyResendMutation();
    if (onPublic || !user || user.is_verified) return null;

    async function handleResend() {
        try {
            await resend().unwrap();
            await notice("Check your inbox for a confirmation link.");
        } catch (err) {
            const detail = err?.data?.detail || "Could not send another link yet.";
            await notice(detail);
        }
    }

    return (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto mx-auto max-w-lg rounded-2xl glass-card border border-volt-400/50 px-4 py-3 flex items-center gap-3">
                <p className="min-w-0 flex-1 text-sm text-gray-200">
                    Confirm <span className="font-bold text-volt-400">{user.email}</span> to get coach emails.
                </p>
                <button type="button" disabled={isLoading} onClick={handleResend}
                        className="shrink-0 rounded-full bg-volt-400 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-950 disabled:opacity-50">
                    Resend
                </button>
            </div>
        </div>
    );
}

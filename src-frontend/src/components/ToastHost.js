import React, {useEffect, useState} from "react";
import {AlertTriangle, CheckCircle2, Info, X} from "lucide-react";

const ICONS = {success: CheckCircle2, error: AlertTriangle, info: Info};
const MAX_VISIBLE = 3;

function ToastCard({toast, onClose}) {
    useEffect(() => {
        const id = setTimeout(onClose, toast.duration || 4500);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const Icon = ICONS[toast.kind] || Info;
    return (
        <button type="button"
                role={toast.kind === "error" ? "alert" : "status"}
                onClick={onClose}
                className={"pointer-events-auto w-full max-w-sm animate-slide-up rounded-2xl glass-card px-4 py-3 flex items-center gap-3 text-left text-sm shadow-lg " +
                    (toast.kind === "error"
                        ? "border border-red-500/40 text-red-700 dark:text-red-300"
                        : "border border-volt-400/40 text-gray-800 dark:text-gray-100")}>
            <Icon aria-hidden="true"
                  className={"h-5 w-5 shrink-0 " + (toast.kind === "error" ? "text-red-500" : "text-volt-600 dark:text-volt-400")}/>
            <span className="min-w-0 flex-1">{toast.message}</span>
            <X className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true"/>
        </button>
    );
}

// Snackbar stack: fixed above the dock, auto-dismissing, tap to close.
// z-[95] keeps toasts visible above sheets (z-50) and dialogs (z-[80]).
export default function ToastHost() {
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        const onToast = (event) => {
            const t = event.detail;
            if (!t?.message) return;
            setToasts((cur) => [...cur.slice(-(MAX_VISIBLE - 1)), t]);
        };
        window.addEventListener("wc-toast", onToast);
        return () => window.removeEventListener("wc-toast", onToast);
    }, []);

    if (toasts.length === 0) return null;

    const close = (id) => setToasts((cur) => cur.filter((t) => t.id !== id));

    return (
        <div className="fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-3 pointer-events-none"
             style={{bottom: "calc(5.5rem + env(safe-area-inset-bottom))"}}
             aria-live="polite">
            {toasts.map((t) => <ToastCard key={t.id} toast={t} onClose={() => close(t.id)}/>)}
        </div>
    );
}

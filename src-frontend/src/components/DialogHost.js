import React, {useEffect, useState} from "react";

export default function DialogHost() {
    const [dialog, setDialog] = useState(null);

    useEffect(() => {
        const onDialog = (event) => setDialog(event.detail);
        window.addEventListener("wc-dialog", onDialog);
        return () => window.removeEventListener("wc-dialog", onDialog);
    }, []);

    if (!dialog) return null;

    const close = (value) => {
        dialog.resolve(value);
        setDialog(null);
    };

    return (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={() => close(dialog.kind === "confirm" ? false : undefined)}>
            <div className="w-full max-w-md rounded-3xl bg-white border border-gray-300 dark:bg-ink-850 dark:border-ink-700/60 shadow-card dark:shadow-card-dark p-6 animate-pop-in"
                 onClick={(e) => e.stopPropagation()}>
                <p className="text-base text-gray-800 dark:text-gray-100 leading-relaxed">{dialog.message}</p>
                <div className="mt-6 flex justify-end gap-3">
                    {dialog.kind === "confirm" && (
                        <button type="button"
                                className="min-h-[44px] px-4 rounded-full text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                                onClick={() => close(false)}>
                            Cancel
                        </button>
                    )}
                    <button type="button"
                            className="min-h-[44px] px-5 rounded-full bg-volt-400 text-ink-950 font-bold text-sm uppercase tracking-wide"
                            onClick={() => close(dialog.kind === "confirm" ? true : undefined)}>
                        {dialog.kind === "confirm" ? "Confirm" : "OK"}
                    </button>
                </div>
            </div>
        </div>
    );
}

import React, {useEffect, useState} from "react";
import {OverlaySheet} from "../forms/basicComponents";

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

    const dismiss = () => close(dialog.kind === "confirm" ? false : undefined);

    return (
        <OverlaySheet title={dialog.kind === "confirm" ? "Confirm" : "Notice"} onClose={dismiss} zClass="z-[80]">
            <p className="text-base text-gray-800 dark:text-gray-100 leading-relaxed">{dialog.message}</p>
            <div className="flex justify-end gap-3">
                {dialog.kind === "confirm" && (
                    <button type="button"
                            className="min-h-[44px] px-4 rounded-full text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                            onClick={() => close(false)}>
                        Cancel
                    </button>
                )}
                <button type="button"
                        className="min-h-[44px] px-5 rounded-full bg-volt-400 text-ink-950 font-bold text-sm uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt"
                        onClick={() => close(dialog.kind === "confirm" ? true : undefined)}>
                    {dialog.kind === "confirm" ? "Confirm" : "OK"}
                </button>
            </div>
        </OverlaySheet>
    );
}

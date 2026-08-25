import {useEffect} from "react";
import {createPortal} from "react-dom";

// Cards use `backdrop-filter` (`.glass-card`). That makes the card a
// containing block and a stacking context for `position: fixed`
// descendants, so an overlay rendered inside a card is sized to the card,
// covered by later cards, and — with body scroll locked — looks like a freeze.
// Always portal overlays to `document.body`.

let lockCount = 0;

export function useBodyScrollLock(active = true) {
    useEffect(() => {
        if (!active) return undefined;
        lockCount += 1;
        document.body.classList.add("body-no-scroll");
        return () => {
            lockCount -= 1;
            if (lockCount <= 0) {
                lockCount = 0;
                document.body.classList.remove("body-no-scroll");
            }
        };
    }, [active]);
}

export function OverlayPortal({children}) {
    return createPortal(children, document.body);
}

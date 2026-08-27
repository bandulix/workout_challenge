import {useEffect} from "react";
import {createPortal} from "react-dom";

// Cards use `backdrop-filter` (`.glass-card`). That makes the card a
// containing block and a stacking context for `position: fixed`
// descendants, so an overlay rendered inside a card is sized to the card,
// covered by later cards, and — with body scroll locked — looks like a freeze.
// Always portal overlays to `document.body`.

let lockCount = 0;

function applyLock() {
    const y = window.scrollY || window.pageYOffset || 0;
    document.body.dataset.wcScrollY = String(y);
    document.body.style.top = `-${y}px`;
    document.body.classList.add("body-no-scroll");
    document.documentElement.style.overflow = "hidden";
}

function removeLock() {
    const y = parseInt(document.body.dataset.wcScrollY || "0", 10) || 0;
    document.body.classList.remove("body-no-scroll");
    document.body.style.top = "";
    delete document.body.dataset.wcScrollY;
    document.documentElement.style.overflow = "";
    window.scrollTo(0, y);
}

export function useBodyScrollLock(active = true) {
    useEffect(() => {
        if (!active) return undefined;
        lockCount += 1;
        if (lockCount === 1) applyLock();
        return () => {
            if (lockCount <= 0) return;
            lockCount -= 1;
            if (lockCount <= 0) {
                lockCount = 0;
                removeLock();
            }
        };
    }, [active]);
}

export function clearBodyScrollLock() {
    if (lockCount === 0 && !document.body.dataset.wcScrollY) {
        document.body.classList.remove("body-no-scroll");
        document.body.style.top = "";
        document.documentElement.style.overflow = "";
        return;
    }
    lockCount = 0;
    removeLock();
}

export function OverlayPortal({children}) {
    return createPortal(children, document.body);
}

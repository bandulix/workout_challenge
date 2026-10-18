// Shared motion preference gate. Design rules in index.css require every
// JS-driven animation and vibration to check this before firing.

export function prefersReducedMotion() {
    if (typeof window === "undefined") return false;
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

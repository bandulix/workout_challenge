/** Single source for the "prefers-reduced-motion" check. CSS animations
 * are gated in index.css; JS-driven motion (drag fly-offs, vibration)
 * must check this at call time. */
export function prefersReducedMotion() {
    return typeof window !== "undefined"
        && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

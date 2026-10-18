# Professional UX Audit — Workout Challenge

**Date:** 2026-10-18  
**Scope:** Auth → Home → Coach → Competition (Feed / Trail / Board) → Settings dock  
**Method:** Code review with file evidence + live browser pass (desktop ~1280px, mobile ~390px) against demo data  
**Status:** All findings implemented on branch `cursor/professional-ux-audit-1f3a`

---

## What’s already strong

- Documented design system in `src-frontend/src/index.css` (volt/ink roles, type scale, motion budget, ≥44px targets)
- Auth gate avoids painting protected-page error boxes for logged-out users
- Lazy routes use a real loading fallback with `role="status"`
- `OverlaySheet` focus trap, Escape stack, `aria-modal`, discard confirm
- Home `EmptyState` / Getting Started checklist; Coach hero standing-by CTAs for owners
- Broad CSS `prefers-reduced-motion` gate; swipe transitions respect it
- Error boundary + Account-load failure retry in the dock

---

## Findings & remediation

| ID | Severity | Surface | Issue | Status |
| --- | --- | --- | --- | --- |
| UX-01 | Critical | Login / Register / cold start | Defaulted to `/coach` while Getting Started lives only on Home | **Fixed** — defaults to `/dashboard` |
| UX-02 | High | Competition Feed (member) | Blank feed when coach not activated (`CoachCorner` returned `null`) | **Fixed** — member empty state |
| UX-03 | High | Motion / haptics | `utils/motion.js` missing; haptics ignored reduced motion | **Fixed** — shared module + haptic gate |
| UX-04 | High | Verify-email banner | Fixed overlay with no page offset | **Fixed** — `html.wc-verify-banner` + `.wc-page-wrap` pad |
| UX-05 | High | Dock / rail | Nav hidden until `/me` succeeds | **Fixed** — loading / retry chrome |
| UX-06 | High | Getting Started → Feed | “Open challenge” omitted `coach=setup` | **Fixed** |
| UX-07 | Medium | Compete control | Multi-challenge users jumped to last challenge | **Fixed** — picker when ≠1 challenge + chevron cue |
| UX-08 | Medium | Feed stamps / replies | Touch targets `min-h-[32px]` | **Fixed** → 44px |
| UX-09 | Medium | Feed Activate CTA | Below 44px | **Fixed** |
| UX-10 | Medium | Welcome CTAs | Log In looked secondary vs Create Account | **Fixed** — Log In primary |
| UX-11 | Medium | Auth forms | Positive `tabIndex` 1–N | **Fixed** — removed |
| UX-12 | Medium | Challenge tabs | Missing `aria-controls` / panel ids | **Fixed** |
| UX-13 | Medium | Contrast | Captions at `text-white/55` / gray-500 on dark washes | **Fixed** — stronger `.text-muted` + caption migration |
| UX-14 | Medium | Home hierarchy | Many passive glass cards vs Coach bleed hero | **Fixed** — Welcome + streak un-carded |
| UX-15 | Medium | Competition stats error | Header replaced on board tab | **Fixed** — keep header |
| UX-16 | Medium | Error boxes | Raw mono `errorMsg` always visible | **Fixed** — `<details>` disclosure |
| UX-17 | Low | Password reset success | Navigated to Welcome | **Fixed** → `/login` |
| UX-18 | Low | Auth brand mark | App icon `alt=""` | **Fixed** |

### Follow-ups from the audit (also shipped)

- Compete discoverability: chevron + `aria-label` when multiple challenges
- Trail empty hint at 0% progress; milestone chips are focusable with `aria-label` status

---

## Live observations (pre-fix)

- Login redirected to Coach; Getting Started not visible on first surface
- Home / Coach / Compete discovery unclear for new users
- Feed / trail / settings generally coherent once on a populated challenge
- Mobile dock clearance mostly OK; verify-email path was the main overlay risk

Evidence screenshots: `/opt/cursor/artifacts/ux-audit-*.png`

# Theme / Appearance Foundation — #290 Slices A and B

## User-facing outcome
Authenticated WORKHUB exposes **表示テーマ** in the Home reference panel. Choose **Light**, **Dark**, **System** (follow OS) or **Unset** (no explicit user selection). The page reacts to the selection immediately as an **unsaved preview**, and the existing shared User Preferences Save control persists the change using the #288 versioned, CSRF-protected `/api/me/preferences` PATCH. Other unsaved preference fields share the existing draft; the UI warns they will be saved together. Reloading uses the server record. No new API, D1 table, secret, or local preference storage is introduced.

## Source of truth and resolution
`src/shared/user-preferences.ts` and `src/frontend/preferences/context.tsx` from #288 remain authoritative. `null` means **unset**, while `"system"` means **explicitly track OS**. The resolved `colorScheme` is used for the WORKHUB-only `data-theme`; `data-theme-mode` retains `light/dark/system`, and `data-theme-source` carries resolver provenance. Existing `matchMedia('(prefers-color-scheme: dark)')` listener updates the shared React context, without additional GET/PATCH or business writes. On logout/identity changes the existing context drops saved-user preferences; no theme credentials or cache are retained.

## Semantic CSS tokens (single implementation source)
`src/workhub.css`, scoped under `.workhub-theme-scope`, defines:
- `--workhub-page`: page background
- `--workhub-surface`, `--workhub-surface-muted`: panel/header/input surfaces
- `--workhub-text`, `--workhub-text-muted`: primary/secondary text
- `--workhub-border`: component boundary
- `--workhub-primary`, `--workhub-focus`, `--workhub-danger`: action/focus/error semantics
- `--workhub-brand-gradient`: separate project-facing branding token

The initial reference covers the WORKHUB shell, header, side navigation, representative cards, primary/secondary buttons, search controls and Theme panel input. The branded travel-request panel retains its intended dark gradient and light-form contrast. `color-scheme` follows resolved theme for native controls. Public `/showcase` and `/reference` do not mount this wrapper and are out of scope.

## Slice B — login/auth bootstrap and initial theme convergence
The WORKHUB-only entry remains `AuthProvider > UserPreferencesProvider > App`. Before authentication, `#288` resolves the OS `prefers-color-scheme` signal; Slice B applies dark semantic tokens to the login form, labels, text, and loading states rather than showing a light-only login panel. No `inline script`, CSP exception, device-local theme hint, or new preference store is introduced.

After a successful authentication, App **waits for the existing shared `loadStatus`** before mounting `TravelWorkspace` / `AdminPortal`. It renders the non-business loading shell with OS/project fallback until the existing `/api/me/preferences` GET returns. Only then does the authenticated application first mount with the server's resolved theme. This prevents a protected screen briefly rendering under the wrong user's or device-fallback color and avoids triggering its normal business GETs before the theme is known. The OS-dark/login -> saved-light/workspace transition is deliberate; we do not claim this eliminates every pre-JS first-paint flash.

A preference GET error is **not** an authentication failure. The authorized WORKHUB remains available under the safe device/project fallback with an explanatory, non-blocking banner and an explicit retry button connected to `#288 reloadSaved()`. No automatic PATCH, duplicate per-component preferences GET, re-login, or business mutation is caused by this path. On logout or user switch, `#288` isolates preferences by authenticated user ID; the login surface returns to OS color without retaining the prior user's setting. We deliberately avoid localStorage/sessionStorage theme hints so there is no stale hint that could override the server preference.

The existing theme E2E covers OS-dark login readability, delayed synthetic saved-light GET with no premature workspace mount, light-to-dark logout convergence and switch to another persona, as well as a synthetic preference GET 503 and explicit retry. It preserves the original saved theme / OS switching scenario. All synthetic responses apply only to the test's local browser route and do not modify Remote D1 or shared Preview.

## Verification / boundaries
- Unit contract: resolved dark/light/system presentation, unset versus explicit system selection, unauthenticated fallback; no duplicated #288 preference resolver.
- Focused browser scenarios: saved theme / OS transition with draft preservation; OS-dark login, delayed synthetic user preference with no premature authenticated screen, logout/user switch isolation; and a synthetic preference failure/retry with no PATCH. Existing fixture state is restored where modified.
- Existing repository-required CI and PR browser workflow are reused. No independent performance benchmark or full device/System Test is added.

## Known limits / remaining original acceptance
These are **Slices A and B**, not full Issue #290 completion. Unconverted fixed colors remain in WORKHUB business CSS, Admin Portal, full forms/tables/dialogs/alerts and various banner states; pre-JS body first paint and every browser-specific flash are not guaranteed away; no device-local theme hint has been introduced; broad #49 contrast/keyboard assessment and remaining component semantics to Slice C; print policy and unverified #60 quantitative performance to Slice D. No claim is made that all screens satisfy WCAG, are flash-free or meet performance SLOs.

Issue #290 original Completion 11 and Validation 14 remain untouched and Open until evidence of each is recorded. Formal ST belongs to #694. No Preview/Production deploy, remote D1/migrations, Secrets, Cloudflare resources, WBS stage/priority/milestone or application behavior unrelated to Theme is changed.

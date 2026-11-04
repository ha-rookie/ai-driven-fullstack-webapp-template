# Theme / Appearance Foundation — #290 Slices A–C

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

## Slice C — project branding and semantic component states
The **single definition** of WORKHUB theme tokens remains `src/workhub.css`, under `.workhub-theme-scope`. Project CSS can set `--workhub-project-brand-gradient` on the WORKHUB scope (e.g. `linear-gradient(90deg, #103255, #214b75)`), without writing to User Preferences or changing the bundled default. `--workhub-brand-gradient` resolves to that override or the WORKHUB fallback, and the employee primary buttons/card, logo and admin header use the same result. Project overrides must maintain readable light text; they do not affect `/showcase` or `/reference`.

Light/Dark semantic states include `--workhub-success`, `--workhub-success-surface`, `--workhub-warning`, `--workhub-warning-surface`, `--workhub-danger-surface`, `--workhub-field-surface`, `--workhub-field-text`, and `--workhub-readonly-surface`. Existing `--workhub-danger`, `--workhub-focus`, and surface/text/border tokens remain canonical. Their consumers are the actual Employee Travel Form and branded inputs, Persona Dialog, workflow notification and returned-request panels, global announcement banner, and Admin Portal shell, audit table, named audit outcomes and error surfaces. The branded Travel Form deliberately keeps white inputs and dark field text, even in dark mode.

Semantic status is **not conveyed by color alone**: existing elements already show labels/headings (e.g. 差戻し理由, 成功/失敗, 重要なお知らせ), and use roles in error/notification contexts. CSS differentiates editable from `[readonly]` and `:disabled` controls with background/border style and retains keyboard `:focus-visible` outlines. No new UI interaction/API is introduced. The already designed Print A4 one-page behavior is retained; the override for the theme scope's min-height remains in Slice A, and dynamic employee fields use light paper controls. Do not conflate that with a formal new Print Policy acceptance test.

The focused desktop Playwright checks the **real** login Persona dialog, Employee Travel Form and Admin Portal surfaces; if an audit table or operational warning is legitimately absent from fixture data, it inserts **inert CSS-only** nodes with the existing classes into the page, checks named status text and computed foreground/background, and removes them with the isolated browser test session. Synthetic CSS states are not proof of actual business data transitions. The audit text/background representative contrast calculation uses a 4.5:1 text target; comprehensive WCAG or all-cases keyboard review remains outside Slice C.

## Verification / boundaries
- Unit contract: resolved dark/light/system presentation, unset versus explicit system selection, unauthenticated fallback; no duplicated #288 preference resolver.
- Focused browser scenarios: saved theme / OS transition with draft preservation; OS-dark login, delayed synthetic user preference with no premature authenticated screen, logout/user switch isolation; and a synthetic preference failure/retry with no PATCH. Existing fixture state is restored where modified.
- Existing repository-required CI and PR browser workflow are reused. No independent performance benchmark or full device/System Test is added.

## Known limits / remaining original acceptance
These are **Slices A–C**, not full Issue #290 completion. Additional fixed colors remain in secondary WORKHUB business/admin/portal components beyond the covered primary forms, modal, alerts, notifications and audit table; pre-JS body first paint and every browser-specific flash are not guaranteed away; no device-local theme hint has been introduced; broader #49 contrast/keyboard assessment and secondary component semantics remain for final review; print policy and unverified #60 quantitative performance to Slice D. No claim is made that all screens satisfy WCAG, are flash-free or meet performance SLOs.

Issue #290 original Completion 11 and Validation 14 remain untouched and Open until evidence of each is recorded. Formal ST belongs to #694. No Preview/Production deploy, remote D1/migrations, Secrets, Cloudflare resources, WBS stage/priority/milestone or application behavior unrelated to Theme is changed.

## Slice D — Print evidence and performance boundary

A new Theme E2E tests local A4 paper output for Light, Dark, and System. Same-environment #60 browser measurements remain pending. Build log comparison showed CSS 99.09 kB to 106.87 kB while JS stayed at 682.46 kB. Do not mark performance or print accepted until tests finish and code is merged.

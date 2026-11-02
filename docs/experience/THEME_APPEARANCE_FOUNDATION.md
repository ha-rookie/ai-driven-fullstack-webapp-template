# Theme / Appearance Foundation — #290 Slice A

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

## Verification / boundaries
- Unit contract: resolved dark/light/system presentation, unset versus explicit system selection, unauthenticated fallback; no duplicated #288 preference resolver.
- One representative browser scenario: Aoi login, unsaved draft, explicit save, OS/system transition, authenticated reload, bounded preference requests and no business mutation. Test restores the saved fixture state.
- Existing repository-required CI and PR browser workflow are reused. No independent performance benchmark or full device/System Test is added.

## Known limits / remaining original acceptance
This is **Slice A**, not full Issue #290 completion. Unconverted fixed colors remain in WORKHUB business CSS, Admin Portal, full forms/tables/dialogs/alerts and various banner states; initial dark-theme flash during auth bootstrap and persistent-but-stale device hint are deferred to Slice B; broad #49 contrast/keyboard assessment and remaining component semantics to Slice C; print policy and unverified #60 quantitative performance to Slice D. No claim is made that all screens satisfy WCAG, are flash-free or meet performance SLOs.

Issue #290 original Completion 11 and Validation 14 remain untouched and Open until evidence of each is recorded. Formal ST belongs to #694. No Preview/Production deploy, remote D1/migrations, Secrets, Cloudflare resources, WBS stage/priority/milestone or application behavior unrelated to Theme is changed.

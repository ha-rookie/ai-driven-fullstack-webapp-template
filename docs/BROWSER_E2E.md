# Browser E2E / PWA Human Smoke

## Purpose

Unit and HTTP boundary tests cannot prove browser History, React bootstrap convergence, retained form state or mobile/PWA navigation behavior. This baseline adds a deliberately small Chromium E2E suite for reusable frontend boundaries without turning browser automation into a full Product regression suite.

## Runner boundary

The Browser E2E workflow uses `@playwright/test` **1.63.0** as pinned CI tooling and installs Chromium only.

The runner is installed with `--no-save --package-lock=false` after the repository's normal `npm ci`. This is intentional:

- Playwright is browser-CI tooling, not an application runtime dependency
- the normal application lockfile remains the source of truth for repository runtime/build dependencies
- the Browser workflow pins the exact Playwright version instead of using `latest`
- only a relevant frontend/E2E path change starts the Browser workflow

When browser tooling becomes necessary for local development or multiple workflows, promote it into the normal devDependencies in a dedicated supply-chain-reviewed change rather than silently widening the lockfile here.

## Automated profiles

The baseline runs the same representative scenarios with one Chromium binary in two profiles:

- desktop viewport: 1280 x 800
- Android-like mobile viewport: 412 x 915 with touch/mobile context

Firefox/WebKit and broad device matrices are intentionally not baseline requirements. Projects with a concrete browser support matrix may add them.

## Automated scenarios

The Reference Harness composes the real reusable frontend contracts rather than a Product page:

- authenticated bootstrap and Protected Route
- stable authenticated state during background synchronization (no regression to pending/checking UI)
- unauthenticated transition and re-authentication
- user navigation through Home → List → Detail
- Browser Back / Forward preserving intermediate views
- reload and direct deep link canonicalization without an extra History entry
- same-view filter/data state not creating a navigation entry
- dirty-state Back guard and restoration of a recognized History entry
- duplicate mutation submit suppression
- 409 conflict preserving the user draft while exposing latest persisted data
- runtime 401 keeping the form mounted, re-authenticating and not replaying the failed mutation
- semantic landmarks and keyboard-reachable controls

The harness is under `e2e/harness/` and is not wired into the Product/default `App`.

## Navigation History policy

`src/frontend/routing/history.ts` keeps Browser History and Application view state separate.

- Project supplies URL encode/decode
- bootstrap canonicalizes with `replaceState`
- user-originated major navigation uses `pushState`
- explicit replacement uses `replaceState`
- Back/Forward restoration comes from `popstate`
- no parallel Application back stack is stored
- History state contains only a version marker and sequence index, not Product/business data
- URL remains Project-defined and must not contain secrets or raw credentials
- a Project leave guard may deny in-app navigation before changing History
- recognized Back/Forward entries can be restored when a leave guard denies navigation
- `beforeunload` helper is available for dirty reload/tab-close warnings

Browser History is not a business transaction log and must never be used to replay or rollback mutations.

## CI quota controls

- Browser E2E is a separate path-scoped workflow
- one browser binary only
- one worker
- no automatic retry masking (`retries: 0`)
- traces and screenshots are retained only on failure
- failure evidence is retained for 7 days
- external OAuth/SSO is not contacted; the harness uses deterministic local identity behavior

## Human smoke: Android / installed PWA

Browser automation does not claim to reproduce every OS-level interaction. Before a Project release that depends on PWA/mobile navigation, record a Human smoke result for the actual supported device/browser.

Minimum Android/PWA smoke:

1. Install/open the PWA in standalone mode if the Product supports installation
2. Navigate Home → List → Detail
3. Use the OS gesture/physical Back action
4. Confirm Detail → List → Home in order
5. Change a same-view filter and confirm Back does not stop at the filter change
6. Start editing a form, then use Back and verify the Product's unsaved-work policy
7. Reload/reopen a deep link and confirm the expected view is restored
8. Allow a session to expire or use a safe test expiry path; confirm the form remains and mutation is not automatically replayed after re-authentication
9. Background/task-switch and resume the installed PWA; confirm no unwanted bootstrap flash or duplicate History entry

Record device/OS/browser or WebView version, application SHA, date, expected result, actual result and any deviation. An unexecuted Human smoke item remains `unverified`; it is not treated as automated success.

# User Preferences Foundation — #288, slice 1 (provider-neutral)

## Purpose and observable outcome

Provide a reusable, framework-neutral preference resolution contract for WORKHUB and future projects. Consumers can resolve locale, IANA timezone and theme from trusted project policy, authenticated user values, device/browser signals and configured defaults. They can test versioned updates with an in-memory reference store. This is **not** a production preference service or a completed WORKHUB preferences UI.

## Priority and trust order

1. Forced project/organization value (must pass policy configuration validation)
2. Saved user value, **only after authentication**
3. Browser/OS candidate (authenticated and unauthenticated)
4. Project default
5. System default

Every candidate must be in the project's allowlist (and a valid locale/IANA timezone where applicable). Unsupported candidates are skipped, rather than silently storing them. Misconfigured forced values and missing acceptable system fallback throw. An explicit null means *unset*, while `theme: "system"` retains the user's selected mode and resolves the color scheme from the OS signal. Consumer-facing resolved values carry their provenance. Browser and OS signals are passed as data; the core never reads `window` or localStorage.

## In-memory reference store (tests/example only)

- `get(userId, environment)` and `update({userId, environment, expectedVersion, patch}, policy)`
- Namespaced by authenticated user and `RuntimeEnvironment` (`local`, `test`, `preview`, `production`); in-memory keys are isolated, **not actual separate deployment databases**
- `expectedVersion=0` creates a record at version 1; each accepted update increments version, and stale/missing-version updates reject instead of last-write-wins
- Field allowlist: `locale`, `timezone`, `theme`; reject arbitrary keys, secrets, credentials and unsupported values, never store browser fingerprint signals
- No persistence, D1 table, migrations, HTTP routes, Auth context changes, logged-in WORKHUB integration or cross-device durability are included in this slice

## Acceptance boundary / follow-ups (original #288 unchanged)

This PR is a **partial** foundation. It supplies tested policy resolution, `unset` versus explicit `system`, validation, optimistic version updates and environment/user separation in memory. It does **not** satisfy original Completion 12/12, notably authenticated server-side durable source of truth, real multi-device sync, frontend resolved context, error/loading UI, D1 integration, actual WORKHUB locale/theme rendering, or full browser/System Testing. Future separate scoped #288 PRs may connect a durable store, current session/authorization middleware and frontend shell, subject to new approval for any forbidden resource operation.

### Change Contract

- Issue: #288 under WBS #132, focus `[288]`; prior main `8c4ac6bbc297517d906ddf5771c3125f20fd1e0e`
- Planned files (4 only): this document, `src/shared/user-preferences.ts`, `src/shared/in-memory-user-preferences-store.ts`, `tests/user-preferences-foundation.test.ts`
- Impact: new shared pure code and in-memory reference adapter only. No existing API, UI, schema, migration, session, R2, Cloudflare setting or runtime wiring changes.
- Selected tests: new `tests/user-preferences-foundation.test.ts` through existing unit compilation / targeted Node test and required CI `validate`; Secret detection if triggered.
- Stop if additional paths, dependencies, a schema change, live provider, API mutation, deployment or remote resource operation would be required. No acceptance checklist edits until the full original gate has verifiable evidence.

## #288 durable Local D1 vertical slice (PR pending, not deployed)

This additional slice builds on the pure resolver / existing API contract. The new ordered
`migrations/0038_user_preferences.sql` creates a dedicated `user_preferences`
table keyed by `(environment, user_id)`, with user FK cascade, positive
version and an allowlisted theme. It does not mutate existing identity columns.
The durable D1 adapter validates each patch and enforces optimistic concurrency
through a **single conditional SQL UPDATE** (or conflict-checked INSERT at version 0).
A stale write returns 409 and never quietly overwrites another device.

The existing `/api/me/preferences` GET/PATCH contract is wired to the Worker.
It retains active session authentication, same-origin CSRF for PATCH, server-owned
user ID, a strict allowed-field policy, no-store responses and environment separation.
The WORKHUB React Preferences Provider performs one GET per authenticated shell,
shares the resolved values with consumers, previews unsaved edits, obtains CSRF
through `/api/auth/csrf` and sends expectedVersion with PATCH. A conflict preserves
an explicit error and offers reload; logout/identity changes do not reuse prior
user values. Device defaults apply only when server preferences are not available.
The three selectors and card demonstration do not translate/theme the whole app.

**Deployment / acceptance boundary:** This change can be validated with Local D1
and required PR CI. No Preview/Production Migration, remote D1 operation,
deployment, Cloudflare resource changes, secrets or PR merge are authorized.
Until the new ordered migration is deliberately applied in each environment,
the API may return a fail-closed 503. An unmerged PR is **not** end-user delivery.
Full browser/system/multi-device remote verification remains separate under
the existing WBS and Issue #694. The original #288 completion checklist is
unchanged; distinguish local tested implementation from confirmed production
or formal acceptance.

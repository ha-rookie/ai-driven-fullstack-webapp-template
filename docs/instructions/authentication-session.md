# Authentication / Session Scoped Instruction

## Applies When

Use this Instruction for external identity verification, internal-user resolution, application-session creation/lookup/revoke, `/api/auth/*`, or authentication-state changes.

## Scope Hints

- auth provider adapters
- `users`, `external_identities`, `application_sessions`
- session cookie handling
- `/api/auth/me`, login/callback/logout boundaries
- session expiry, revoke, rotation, lifecycle changes

## Sources to Read

- `../AUTH_DESIGN.md`
- `../DATA_DESIGN.md`
- `../AUDIT_OBSERVABILITY.md` when audit/correlation changes are involved
- applicable Common Template security / testing Instructions

## Rules

- Keep External Identity, Internal User, and Application Session as separate concepts
- Resolve provider identity to an internal user before establishing authenticated application context
- A valid session is not sufficient when its referenced internal user is missing, disabled, unavailable, or otherwise invalid under the current lifecycle policy
- Persist only hashed opaque session tokens; return raw tokens only through the browser/session boundary
- Preserve secure cookie attributes and explicit expiry/revocation semantics
- Treat logout/revoke as server-side invalidation, not only client-side cookie removal
- Keep provider-specific claims, secrets, redirects, and token exchange inside provider adapters
- If authentication level or privilege changes, use the shared session lifecycle/rotation design rather than duplicating provider-specific session logic

## Do Not

- Do not use provider subject/email/display name as the application user ID without the explicit identity mapping contract
- Do not store raw session tokens in D1, logs, Audit, fixtures, or client-side application storage
- Do not auto-link or auto-merge users from matching email/display name without explicit Product policy
- Do not recreate a missing internal user merely because a stale session still validates cryptographically
- Do not mix role/permission decisions into the authentication foundation
- Do not expose detailed internal authentication failure reasons to unauthenticated clients

## Validation / Evidence

- valid identity → mapped valid user → application session → authenticated request succeeds
- missing/expired/revoked/stale session fails closed
- mapped user missing or invalid does not produce partial authenticated state
- logout/revoke makes the previous session unusable
- no raw token/secret appears in persistence, logs, Audit, or test snapshots
- provider-specific tests remain separated from provider-neutral session tests
- Local/boundary tests pass without requiring a real external provider unless the Issue explicitly scopes one

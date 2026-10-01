# Authentication Design

## Purpose

Define the provider-independent authentication baseline for this Full-stack Template.

Authentication answers **who the caller is**. Authorization answers **what that caller may do** and is intentionally handled by a later Issue.

## Boundary

```text
External Identity Provider
        ↓
   Provider Adapter
        ↓
Verified External Identity
        ↓
    Internal User
        ↓
 Application Session
        ↓
 Authenticated Request
```

The Template does not choose a concrete external provider. Provider-specific redirects, callback URLs, client IDs, client secrets, scopes, token exchange, and profile APIs belong in provider adapters added by a project or later profile.

## Provider contract

`AuthProvider<Credential>` exposes only:

- a stable provider identifier
- verification of provider-specific credentials into a `VerifiedExternalIdentity`

A verified identity contains:

```text
provider
subject
optional displayName
```

The application must not use the provider subject as its internal user ID. `external_identities` maps the provider identity to an internal `users.id`.

User creation and identity-linking workflows are deliberately not implemented in this foundation because those operations can require multi-write atomicity and race handling.

## Authentication data

`migrations/0002_auth_foundation.sql` adds the provider-independent user/session baseline. `migrations/0007_session_idle_timeout.sql` later adds `last_seen_at` without rewriting the original migration.

```text
users
  id
  display_name
  created_at
  updated_at

external_identities
  provider
  provider_subject
  user_id
  created_at

application_sessions
  token_hash
  user_id
  expires_at
  revoked_at
  created_at
  last_seen_at
```

The idle-timeout migration is additive. Existing rows are backfilled to the migration execution time so deployment does not immediately invalidate every otherwise-active session. It does not delete session data, rebuild the table, or rewrite prior migrations.

No role or permission columns are included in the authentication foundation.

## Application session strategy

The baseline uses a **DB-backed opaque session**.

1. generate 32 bytes of cryptographically secure random data
2. encode it as a URL-safe session token
3. SHA-256 hash the token
4. store only the hash in D1
5. send the raw token to the browser as a cookie
6. hash incoming cookie values before session lookup

The raw session token must not be persisted in D1 or logs.

This differs from a self-contained signed session cookie: server-side storage allows explicit revoke/logout before expiry, user-wide revocation, session rotation, and server-side idle activity tracking.

## Cookie baseline

The session cookie is named `app_session` and uses:

```text
Path=/
HttpOnly
Secure
SameSite=Lax
```

A successful logout revokes the matching server-side session and clears the browser cookie with `Max-Age=0`.

Projects may later add stricter cookie or CSRF controls where their threat model requires them, but weakening `HttpOnly` or `Secure` is not part of the baseline.

## Session validity

A request is authenticated only when:

- the cookie is present
- its hash matches an `application_sessions` row
- the session is not revoked
- `expires_at` is later than the current time
- `last_seen_at` is present and later than the idle cutoff
- the referenced internal user still exists

The absolute expiry and idle timeout are independent. Activity can refresh `last_seen_at`, but it never extends `expires_at`.

Expired, idle-expired, malformed-activity, or revoked sessions are all treated as unauthenticated at the public HTTP boundary. The client is not told which internal validity check failed.

## Idle timeout and bounded activity writes

The Reference defaults are:

```text
absolute TTL        24 hours
idle timeout        30 minutes
activity touch       5 minutes
```

Runtime overrides use:

```text
SESSION_IDLE_TIMEOUT_SECONDS
SESSION_TOUCH_INTERVAL_SECONDS
```

Both values must be positive integers and the touch interval must be shorter than the idle timeout. Invalid configuration fails closed rather than silently weakening the timeout.

A naive implementation would write `last_seen_at` on every authenticated request. That is not the Template baseline because it unnecessarily consumes D1 write operations. Instead, a valid session is physically touched only when its stored activity is at least the configured touch interval old.

The touch is conditional on:

```text
token_hash matches
revoked_at is NULL
absolute expiry is still in the future
last_seen_at still equals the value that was observed
```

This prevents concurrent requests from moving `last_seen_at` backwards. If another request has already refreshed the row, the stale touch simply affects zero rows.

Because writes are coalesced, stored activity can lag real activity by up to the touch interval. Projects that require tighter idle-time precision can shorten the interval, accepting the corresponding D1 write increase.

## Explicit session revocation

Revocation is distinct from timeout. A timeout decides whether a session is currently acceptable; revocation records an explicit durable invalidation in `revoked_at`.

`revokeAllApplicationSessionsForUser(...)` revokes every non-revoked session row for a target user and returns the affected row count. It intentionally does not filter out absolute-expired or idle-expired rows. This means an explicit revoke remains durable even if timeout configuration changes later.

`revokeOtherApplicationSessionsForUser(...)` preserves the current request's application session and revokes the target user's other non-revoked sessions. Before mutating rows, the service:

1. reads the current `app_session` cookie
2. hashes the raw token server-side
3. verifies that the hash belongs to an unrevoked session owned by the target user
4. fails closed without revoking anything when ownership cannot be proven
5. revokes the target user's remaining non-revoked session rows

The raw token and token hash are not returned from the service and must not be added to Audit or application logs.

Both bulk revocation operations are idempotent: already-revoked rows are not changed, and a repeated operation can return `revokedCount = 0`.

Administration authorization is deliberately not embedded in the authentication service. A future Administration HTTP boundary must authenticate and authorize the actor before invoking these services.

## Session rotation

`rotateApplicationSession(...)` replaces a valid current session token when authentication state or a privilege/authentication boundary changes. Provider adapters and future login/MFA flows can reuse this service rather than implementing token replacement independently.

Rotation uses the same validity baseline as normal authentication. Missing, revoked, absolute-expired, idle-expired, malformed-activity, or user-orphaned sessions cannot be rotated.

The sequence is:

```text
current raw cookie token
  -> hash server-side
  -> pre-read valid current session
  -> generate new random opaque token + hash
  -> D1 batch
       1. conditional revoke old session
       2. insert new hashed session only when revoke changed 1 row
  -> secure Set-Cookie
```

The old-session UPDATE includes the observed `user_id`, `expires_at`, and `last_seen_at`. A concurrent activity touch, revoke, or rotation therefore causes the operation to fail closed rather than silently rotating stale state.

The new session preserves the previous absolute `expires_at`. Rotation **does not grant a new 24-hour lifetime**. Its `created_at` and `last_seen_at` become the rotation time, so idle activity restarts while the original absolute lifetime remains the upper bound.

The returned cookie keeps the baseline attributes:

```text
Path=/
HttpOnly
Secure
SameSite=Lax
```

Its `Max-Age` is calculated from the remaining absolute lifetime. The service result exposes the cookie value required by the HTTP boundary, but does not expose the raw token as a separate field. D1 stores only the new token hash.

CSRF proof is session-token-bound. After rotation, a proof derived from the previous token is no longer valid; the client must obtain a new proof from `GET /api/auth/csrf` before the next protected mutation.

This issue provides the reusable service only. It does not add a new public rotation endpoint or provider-specific callback flow.

## Runtime endpoints

### `GET /api/auth/me`

Returns the current internal user when a valid application session exists. Session validity includes absolute expiry and idle timeout.

Without a valid session it returns `401` with:

```json
{"authenticated":false}
```

The response intentionally contains no roles or permissions yet.

### `GET /api/auth/csrf`

Returns a CSRF proof only when the same application session is currently valid. Idle-expired sessions cannot obtain a new proof.

### `POST /api/auth/logout`

Revokes the matching server-side session and clears the browser cookie. Revocation still operates on the presented cookie token and does not depend on the idle-timeout resolver; an already-idle session may still be explicitly logged out.

Bulk user-session revocation and session rotation do not expose public HTTP endpoints in these foundation issues. Administration and provider-specific HTTP boundaries remain separate concerns.

## Secrets and public repositories

This foundation contains no provider secret and requires no authentication secret because session tokens are random opaque values whose hashes are stored in D1.

When a concrete OAuth/OpenID provider is added:

- client secrets must use runtime secret storage
- secrets must never be committed
- Preview and Production credentials must be separated
- provider callback configuration must be documented and verified per environment

## Out of scope

This foundation does not define:

- a concrete OAuth/OpenID provider
- user auto-registration
- multi-write identity linking
- roles or memberships
- authorization policy
- invitation flows
- system administrator bootstrap
- account recovery
- active-session listing UI/API
- Administration API/UI for bulk revocation
- provider-specific login/MFA rotation trigger endpoints
- persistent security-event storage
- client-side idle warning UI
- scheduled session cleanup

Those concerns remain explicit later design decisions rather than hidden behavior in the authentication baseline.

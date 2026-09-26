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

`migrations/0002_auth_foundation.sql` adds:

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
```

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

This differs from a self-contained signed session cookie: server-side storage allows explicit revoke/logout before expiry.

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
- the referenced internal user still exists

Expired or revoked sessions are treated as unauthenticated.

## Runtime endpoints

### `GET /api/auth/me`

Returns the current internal user when a valid application session exists.

Without a valid session it returns `401` with:

```json
{"authenticated":false}
```

The response intentionally contains no roles or permissions yet.

### `POST /api/auth/logout`

Revokes the current server-side session when one exists and clears the browser cookie.

Calling logout without an active session is idempotent and still returns `204`.

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
- audit events
- account recovery
- session cleanup scheduling

Those concerns remain explicit later design decisions rather than hidden behavior in the authentication baseline.

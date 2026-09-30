# CSRF Protection

## Purpose

This Full-stack Template uses an `HttpOnly` Cookie-based Application Session. Mutation endpoints therefore need an explicit CSRF proof in addition to Authentication, Authorization, Origin/CORS checks, and `SameSite` cookie attributes.

CORS is **not** treated as the CSRF control. `SameSite=Lax` is defense in depth, not the only boundary.

## Reference strategy

The Reference implementation uses a session-bound proof derived from the opaque application session token:

```text
v1.<base64url SHA-256("csrf:v1:" + sessionToken)>
```

The raw `app_session` value remains `HttpOnly` and is never returned to frontend code.

The CSRF proof:

- is not stored in D1
- does not require a second CSRF cookie
- is stable for the lifetime of one session token
- automatically changes when the session token changes
- cannot be used as an Application Session by itself
- must never be logged or written to Audit

This is a Template Reference contract, not a requirement that every project use this exact token representation. Projects may replace the strategy if they preserve an explicit non-cookie proof, fail-closed mutation validation, and the same separation of responsibilities.

## Token endpoint

An authenticated client obtains the proof through:

```http
GET /api/auth/csrf
Cookie: app_session=...
```

Success:

```json
{
  "csrfToken": "v1...."
}
```

The endpoint first validates the Application Session. A missing, expired, or revoked session receives the ordinary authentication failure contract rather than a CSRF token.

## Mutation contract

Cookie-authenticated mutation requests send:

```http
X-CSRF-Token: v1....
```

The baseline safe methods are:

```text
GET
HEAD
OPTIONS
```

Safe methods do not require CSRF proof and must not mutate trusted state.

For every other method, when an Application Session cookie is present, the Guard requires a valid session-bound proof. If there is no Application Session cookie, the CSRF Guard does not manufacture a `401` or `403`; Authentication remains responsible for deciding whether the endpoint is public or protected.

Missing, malformed, or mismatched proofs intentionally share one public response:

```text
HTTP 403
code: csrf_failed
message: CSRF validation failed
```

The client response does not reveal whether the proof was missing, malformed, or merely mismatched.

## Boundary order

The protected mutation order is:

```text
Origin / CORS
   ↓
Authentication
   ↓
CSRF Protection
   ↓
Resource Scope / Authorization
   ↓
Request Body / Validation
   ↓
Concurrency / Runtime Integrity
```

This order has deliberate properties:

- disallowed browser Origins are rejected before D1-backed Authentication
- CORS preflight is answered before Authentication and never requires CSRF proof
- unauthenticated mutation remains an Authentication failure
- an authenticated request with an invalid CSRF proof is rejected before resource lookup, Authorization, body parsing, or mutation

## Origin / CORS interaction

Issue #67 owns cross-origin admission and preflight. Issue #89 only owns the anti-forgery proof.

The CORS baseline includes `X-CSRF-Token` in the allowed request-header set so an explicitly allowed cross-origin frontend can preflight the header.

CORS still uses an exact Origin allowlist and credentials response headers. CSRF does not broaden that allowlist.

The Application Session cookie remains:

```text
Secure; HttpOnly; SameSite=Lax
```

Issue #89 does not change Cookie attributes. A project that needs truly cross-site authenticated cookies must make that separate security decision explicitly.

## Logout

`POST /api/auth/logout` is a mutation. When an Application Session cookie is present, logout therefore requires the same CSRF proof.

A request without an Application Session cookie may remain an idempotent `204` logout because there is no authenticated browser state to forge.

## Audit boundary

CSRF rejection may emit bounded metadata such as:

```text
category: authentication
action: csrf_guard
outcome: failure
reason: csrf_proof_missing_or_invalid
```

The following are forbidden in Audit / logs:

- raw `app_session` token
- derived CSRF token
- Cookie header
- `X-CSRF-Token` header value

Issue #91 may later standardize security-rejection events. This Issue does not add a persistence schema or new security-event store.

## Session rotation and revocation

CSRF does not implement Session Rotation or Revocation.

Because the proof is derived from the current session token, a future session rotation automatically invalidates the previous CSRF proof without a second storage update. Session revocation remains owned by the Authentication/Session layer.

## Testing requirements

Projects preserving this pattern should test at least:

- safe method without proof succeeds when otherwise permitted
- unauthenticated mutation remains an Authentication failure
- authenticated mutation with missing proof fails 403
- malformed/mismatched proof fails 403 using the same public error
- valid proof reaches Authorization and Domain validation
- rejected request leaves persisted state unchanged
- cross-origin preflight accepts `X-CSRF-Token` only through the configured CORS policy
- no session or CSRF values appear in logs/Audit

The Template CI obtains the Reference proof through `/api/auth/csrf` for each fixture session before running protected mutation scenarios.

## Out of scope

This contract does not cover:

- OAuth/OIDC `state` / `nonce`
- SAML replay protection
- API Key or service-to-service authentication
- WAF configuration
- Product-specific HTML forms
- Session rotation / revocation implementation
- persistent security-event schema

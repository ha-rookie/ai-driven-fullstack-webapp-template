# Protected Boundary Testing

## Purpose

This Full-stack Template turns the upstream Generic Template's high-risk boundary-testing guidance into an executable HTTP + Local D1 pattern.

The goal is not only to check response codes. Rejected requests must also prove that persisted state did not change.

## Boundary flow

```text
HTTP Request
   ↓
Authentication Guard
   ↓
Resource Scope lookup
   ↓
Scoped Authorization Guard
   ├─ membership lookup
   └─ pure role/scope policy
   ↓
Input Validation
   ↓
Concurrency Precondition
   ↓
Runtime Integrity Store
   ↓
Audit
   ↓
HTTP Response
```

Each layer owns a different decision. UI validation is never treated as a substitute for this trusted boundary.

The HTTP guards introduced by Issue #62 centralize the 401/403 contract, but they do not replace the pure authorization policy. Membership, role, and scope decisions still come from `authorizeScopedAction(...)`.

## Example protected API

The neutral example resource is exposed through:

```text
GET   /api/scopes/:scopeId/example-resources/:resourceId
PATCH /api/scopes/:scopeId/example-resources/:resourceId
POST  /api/scopes/:scopeId/example-resources/:resourceId/status
```

The sample role policy exists only in this Example API:

```text
viewer -> read
editor -> read + write
```

Projects should replace those role names and actions with their own vocabulary. They are not Template-core roles.

## HTTP mapping

| Boundary result | HTTP | Error code |
| --- | ---: | --- |
| invalid request body | 400 | `invalid_request` |
| malformed / conflicting concurrency precondition | 400 | `invalid_precondition` |
| no valid session | 401 | `authentication_required` |
| membership / role / scope denied | 403 | `forbidden` |
| resource missing / unscoped | 404 | `resource_not_found` |
| body `expectedVersion` stale | 409 | `stale_update` |
| terminal resource | 409 | `resource_immutable` |
| trusted state changed | 409 | `state_changed` |
| disallowed state transition | 409 | `invalid_transition` |
| `If-Match` stale | 412 | `precondition_failed` |
| missing concurrency precondition | 428 | `precondition_required` |
| dependency failure | 503 | `*_unavailable` |

Authorization denial details remain in the Audit record. The API response stays generic instead of exposing policy internals.

A D1/dependency failure is not treated as missing authentication or denied authorization. The guard lets those failures propagate so the endpoint can return `503` rather than an incorrect `401` or `403`.

## HTTP concurrency precondition

Issue #124 keeps the Domain/D1 optimistic-concurrency rule independent from its HTTP representation. The Runtime Integrity Store still receives one positive `expectedVersion`; the HTTP boundary is responsible for obtaining that version from the request.

The Reference implementation accepts either:

```http
If-Match: "v3"
```

or the existing body contract:

```json
{
  "expectedVersion": 3
}
```

Both may be supplied together only when they identify the same version. A mismatch fails closed with `400 invalid_precondition` rather than guessing which value should win.

The Reference ETag format is `"v<version>"`. Weak validators, wildcard `If-Match`, malformed tags, and multi-value tags are deliberately rejected by this narrow baseline. Projects may adopt another concurrency-token representation, but they should preserve the same boundary properties: an explicit client-observed token, fail-closed parsing, no silent token refresh immediately before mutation, and stale-write rejection.

A mutation with no concurrency token returns `428 precondition_required`. This prevents accidental last-write-wins behavior.

For backward compatibility, a stale body-only `expectedVersion` keeps the existing `409 stale_update` contract. When `If-Match` participates in the request, stale data maps to HTTP conditional-request semantics: `412 precondition_failed`. Domain conflicts that are not version staleness—terminal state, trusted state change, or invalid transition—remain `409`.

Successful GET and mutation responses expose the current version in the resource body and also return the Reference `ETag`. ETag is not a mandatory project-wide representation; it is the concrete Example API implementation of the reusable precondition boundary.

## Standard error envelope

Issue #63 routes ordinary API errors through one HTTP mapper. The baseline error shape is:

```json
{
  "error": {
    "code": "resource_not_found",
    "message": "Resource not found"
  },
  "requestId": "request-correlation-id"
}
```

The same `requestId` is also returned in the `x-request-id` response header. This lets a client-visible error be correlated with Audit/runtime evidence without exposing stack traces, database details, provider claims, or other internal diagnostics.

Validation failures may add bounded field-level issues inside `error.issues`. Conflict and precondition responses may preserve endpoint-safe state such as the current public version outside the `error` object. Neither extension may replace the standard `error` or `requestId` fields.

`AppError` is mapped centrally from application error code to HTTP status, including `412 precondition_failed` and `428 precondition_required`. Its internal `message`, `cause`, and stack are not client output. Server-side/unknown failures fail safe to a generic `500 internal_error` response.

Not every non-2xx response is forced into this envelope. Purpose-specific probe contracts such as health status and `/api/auth/me` unauthenticated-state discovery keep their explicit response semantics unless their own contract is changed separately.

## Scope binding

Issue #17 adds a one-to-one bridge:

```text
example_resources
       ↓ 1:1
example_resource_scope_bindings
       ↓
resource_scopes
```

This migration does not rewrite older migrations or silently assign old example resources to a scope. An unbound resource is not visible through the protected Example API.

A real project may choose to put `scope_id` directly on its domain resource when that is the natural data model.

## Negative-path contract

The Local D1 boundary fixture verifies these cases in order:

1. unauthenticated write -> reject
2. viewer write -> reject
3. editor in another scope -> reject
4. invalid input -> reject
5. editor rename -> success
6. stale body-version rename -> reject with the backward-compatible 409 contract
7. invalid state transition -> reject
8. `draft -> active` -> success
9. `active -> finalized` -> success
10. mutation after finalized -> reject

After every rejection, a permitted GET reloads the resource from D1 and asserts the expected name, status, and version.

At the end, CI directly checks `example_resource_changes` and requires exactly three change records: one rename and two valid state transitions. This detects partial writes or hidden changes that a status-code-only test would miss.

## Audit evidence

The same runtime smoke verifies structured events for:

- authorization `role_required`
- authorization `resource_scope_mismatch`
- mutation `invalid_request`
- mutation `stale`
- mutation `invalid_transition`
- mutation `immutable`
- successful rename
- successful state transition

Audit records contain identifiers and bounded reasons, not raw Cookie/token/request-body data.

Guard unit tests additionally verify that:

- missing authentication maps to the shared 401 contract
- membership / role / scope denials map to the shared 403 contract
- unconfigured actions fail closed
- internal authorization reasons are not exposed in the HTTP body
- dependency failures are not converted into 401/403

API error mapper unit tests additionally verify that:

- representative 400 / 401 / 403 / 404 / 409 / 412 / 422 / 428 / 429 / 500 statuses use one envelope
- request correlation is present in the response body and header
- validation issues retain only bounded client-safe context
- AppError internal detail is not exposed
- unknown failures return a generic 500
- endpoint-safe conflict context cannot override `error` or `requestId`

Concurrency-precondition unit tests additionally verify that:

- body `expectedVersion` remains supported
- strong Reference `If-Match` values resolve to a version
- matching header/body values are accepted and conflicting values fail closed
- missing preconditions return 428
- malformed / weak / wildcard / multi-value tags are rejected
- body-only stale mapping remains 409 while `If-Match` stale mapping is 412
- Reference ETags are generated only from positive safe versions

## Local-first execution

Boundary tests use only Local D1:

```text
migrations
  ↓
Local D1
  ↓
protected-boundary fixture
  ↓
Vite + Worker local runtime
  ↓
curl HTTP boundary scenarios
```

No Preview or Production database is touched. This keeps CI deterministic and avoids consuming remote D1 quotas.

## What projects should preserve

When replacing `example_resources`, preserve the test shape rather than the sample business words:

- positive path
- unauthenticated reject
- authorization reject
- cross-scope reject
- invalid-input reject
- explicit concurrency precondition
- stale/concurrent reject
- terminal/state-transition reject where applicable
- data unchanged after reject
- multi-write completeness after success
- Audit evidence for important failures and mutations

The exact HTTP routes, roles, resource model, ETag representation, and state machine remain project decisions.
